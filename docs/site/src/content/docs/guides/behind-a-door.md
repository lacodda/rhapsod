---
title: Behind a door
description: Serving the stand over https, so the reader works away from home - and why a local certificate is the way to do it.
---

The reader holds the library on the device so it can be read where the stand cannot be reached. Browsers only allow that behind a secure connection: a service worker will not register, and the caches are not handed out, unless the page came over `https` or from `localhost`.

So a stand on plain `http` gives a reader who works at home and stops at the front door. Nothing in the app can repair that, and the app says so - the stand screen answers **Not ready for the road** with the connection as the reason.

`localhost` is enough while you are developing. This guide is about the other case: a stand on a machine on your network, read from a phone.

## What this is not

You do not need a domain name, a public address, or a certificate authority anyone else trusts. The stand is on your network and is meant to stay there. Publishing it to get a certificate would be solving a harder problem than the one you have, and a worse one.

What you need is a certificate your own devices accept. That means a small certificate authority of your own, one root certificate carried to each device once, and a proxy that issues the rest.

## The shape of it

Something in front of the stand terminates TLS and forwards to it:

```
phone ──https──> proxy ──http──> rhapsod on 8084
```

The stand itself is unchanged. It serves plain HTTP on its port, the proxy holds the certificate, and `RHAPSOD_PORT` never has to be reachable from anywhere but the proxy.

Any reverse proxy does this. [Caddy](https://caddyserver.com) is the shortest route, because it has its own certificate authority built in and needs no certificate files at all:

```caddyfile
{
	# NOT `auto_https off`: that turns off certificate management along with
	# the redirect, and a local certificate would never be issued.
	auto_https disable_redirects
}

http://reader.example, https://reader.example {
	tls internal
	reverse_proxy localhost:8084
}
```

`tls internal` means "issue this from my own authority". The first request creates the authority and the certificate; nothing is fetched from anywhere.

Caddy installed from its Debian package keeps this file at `/etc/caddy/Caddyfile`; after an edit, `sudo systemctl reload caddy` picks it up without dropping connections. `localhost:8084` assumes Caddy runs on the same machine as the stand.

### A name the phone can find

`reader.example` has to resolve to the Pi on the phone, and a phone has no hosts file to edit. The name goes into whatever answers DNS on your network: the router's local names, or a resolver like Pi-hole if one already runs there. Point the name at the Pi's address and check it from the phone's browser over plain `http` first - if that does not open, the certificate is not the problem yet.

### Only through the door

With a proxy in front, the stand's port no longer needs to answer the network. In the stand's `.env`:

```sh
RHAPSOD_BIND=127.0.0.1
```

then `docker compose up -d`. The doctor's `door` line turns to `published on 127.0.0.1:8084 - only a proxy on this machine can reach it`.

Everything that used to talk to `http://pi:8084` now goes through the door too, and that includes the publishing and export scripts. Set `RHAPSOD_PUBLISH_URL` to the `http://` name the proxy answers - the plain scheme, which the proxy keeps open, so the scripts do not have to trust the root.

### Keep plain HTTP alongside

Both schemes are listed above, and the redirect is off, on purpose.

A certificate from a local authority is short-lived - Caddy issues twelve hours at a time and renews continuously. That is fine while the proxy runs and a locked door if it ever stops. Leaving `http://` answering costs nothing and is the way back in.

It also matters that each name is listed under **both** schemes. A name written without one is bound to the HTTPS port alone, and every bookmark to the plain address stops working.

## Trusting the root, once per device

Until the root is trusted, the browser shows a warning - and, more to the point, will not treat the page as secure, which is the thing you came for.

Caddy keeps its root here:

```
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

Copy that one file to each device. Only the root: the certificate for the name itself is served by the proxy and changes constantly.

- **Android** - Settings, Security, *Encryption and credentials*, *Install a certificate*, **CA certificate**. The system warns that your network could be monitored; that is the expected warning for an authority you created. Chrome trusts user-installed roots, which is what the reader needs.
- **iOS** - open the file, install the profile, then go to Settings, General, About, *Certificate Trust Settings* and turn the switch on. Both steps are needed: a profile that is installed but not trusted does nothing.
- **Desktop** - add it to the system or browser certificate store.

The authority lives on the Pi's card. A Pi rebuilt from scratch makes a new one, and every device has to trust the new root - unless the `pki` directory above was kept and put back before Caddy first starts.

Then open the stand over `https` and check the stand screen. **Ready for the road.** means the browser accepted all of it: the connection, the worker, the index, and the pieces.

## Checking without a phone in hand

```sh
curl --cacert root.crt https://reader.example/api/health
```

A certificate problem fails here with a verification error rather than a status code. If this passes and the phone still complains, the problem is the trust store on the phone, not the stand.
