use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use rhapsod::{app, auth, config, db, library};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

/// A self-hosted reader for a markdown library: progress, notes and spaced
/// repetition.
#[derive(Parser)]
#[command(version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the HTTP server: the API and the reading app.
    Serve,
    /// Hash a password for `RHAPSOD_PASSWORD_HASH`.
    ///
    /// Without a hash to put in the variable, locking a stand means finding
    /// an Argon2 tool elsewhere, and most of what turns up online is a web
    /// form asking for the password.
    Hash {
        /// The password to hash. Prompted for if omitted.
        password: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Loaded before the logger so RUST_LOG can live in .env too. A missing
    // file is normal: in production the environment is set by the deployment.
    match dotenvy::dotenv() {
        Ok(_) | Err(dotenvy::Error::Io(_)) => {}
        Err(error) => return Err(error).context("failed to read .env"),
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("rhapsod=info,tower_http=info")))
        .init();

    let cli = Cli::parse();

    // The configuration is read only where it is needed: hashing a password
    // is the first thing an owner does, before there is a library to point
    // RHAPSOD_CONTENT_DIR at.
    match cli.command {
        Some(Command::Hash { password }) => {
            let password = match password {
                Some(password) => password,
                None => rpassword::prompt_password("Password: ").context("failed to read the password")?,
            };
            anyhow::ensure!(!password.trim().is_empty(), "an empty password is not a password");
            println!("{}", auth::hash(&password)?);
            Ok(())
        }
        // Running the binary with no arguments serves, which is what a
        // container image or a systemd unit expects.
        None | Some(Command::Serve) => serve(&config::Config::from_env()?).await,
    }
}

async fn serve(config: &config::Config) -> Result<()> {
    // The library is the reason the server exists; a directory that is not
    // there is a deployment error and is reported before anything listens.
    anyhow::ensure!(
        config.content_dir.is_dir(),
        "RHAPSOD_CONTENT_DIR is not a directory: {}",
        config.content_dir.display()
    );

    let pool = db::connect(&config.database_url).await?;

    // The index is built before the port is bound: a server that answers
    // before it has read the library would serve an empty one for the first
    // seconds after every restart.
    let content_dir = config.content_dir.clone();
    let library = tokio::task::spawn_blocking(move || library::Library::load(&content_dir))
        .await
        .context("the library could not be indexed")??;
    tracing::info!(pieces = library.len(), sections = library.sections().len(), "library indexed");

    let listener = TcpListener::bind(config.addr)
        .await
        .with_context(|| format!("failed to bind {}", config.addr))?;
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        addr = %config.addr,
        content = %config.content_dir.display(),
        "rhapsod listening"
    );

    axum::serve(
        listener,
        app::router(pool, &config.web_dir, library, config.content_dir.clone(), config.password_hash.clone()),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("server error")?;
    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to install the shutdown signal handler");
        return;
    }
    tracing::info!("shutting down");
}
