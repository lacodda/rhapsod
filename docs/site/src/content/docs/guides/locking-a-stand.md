---
title: Locking a stand
description: Putting a password on the reader - rhapsod hash, RHAPSOD_PASSWORD_HASH, quoting it in a .env, and what changes for the reader.
---

A stand with no password is **open**: everyone who can reach it is the reader. On a home network with one reader that is a reasonable way to run, and it is the default.

This guide is about the other case - a stand you would rather not have answer to whoever is on the network.

## An open stand is a choice, not an oversight

rhapsod does not demand a password at startup. Making one mandatory before there is anything to protect only teaches an owner to set a blank one, and a blank password is worse than none: it looks like a lock.

So the decision is yours, and it is one variable. Set `RHAPSOD_PASSWORD_HASH` and the stand is locked; leave it unset and it is open.

## Making the hash

The value is an Argon2id hash, not the password. The binary makes one:

```sh
rhapsod hash 'a good passphrase'
```

```
$argon2id$v=19$m=19456,t=2,p=1$wVUyLxTmlnEWzGSHbJINbg$sdR7z5K3zoywehEIBHEqAXDsZILU908I9bQLGkCRYgg
```

Omit the password and it is prompted for, so it never reaches your shell history:

```sh
rhapsod hash
```

```
Password:
```

An empty password is refused:

```
Error: an empty password is not a password
```

The subcommand exists because without it, locking a stand means finding an Argon2 tool elsewhere, and most of what turns up online is a web form asking for the password. The parameters are the crate's defaults, which are the ones OWASP recommends. The salt is random per password and travels inside the string, so nothing else has to be stored beside it: hashing the same password twice gives two different values, and both are correct.

## Putting it in the environment

The whole string, including the `$argon2id$` prefix, is the value:

```sh
RHAPSOD_PASSWORD_HASH='$argon2id$v=19$m=19456,t=2,p=1$wVUyLxTmlnEWzGSHbJINbg$sdR7z5K3zoywehEIBHEqAXDsZILU908I9bQLGkCRYgg'
```

**Single-quote it.** A PHC string is full of `$`, and in a `.env` file - and in most shells and in Docker Compose - an unquoted `$argon2id`, `$v` or `$m` is a variable that expands to nothing. What reaches the server is the wreckage:

```
=19=19456,t=2,p=1
```

The symptom is the right password being rejected forever. Single-quoted, the same line arrives whole.

If that happens, the server says so rather than blaming you: a value it cannot parse as a PHC string is a deployment error, answered `500` with `{"error":"the stand's password is misconfigured"}` and logged naming the variable. A wrong password looks different - `401` and `{"error":"that is not the password"}`.

A blank or whitespace-only value counts as unset. `RHAPSOD_PASSWORD_HASH=` leaves the stand open rather than locking it with an empty password.

On the stand this goes in the `.env` next to the compose file, which passes it into the container - see [Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/). The server reads the environment once at startup, so a change takes a restart:

```sh
docker compose -f docker-compose.prod.yml up -d
```

Check it took: a locked stand says so before anyone types anything.

```sh
curl http://pi:8084/api/session
```

```json
{"open":false,"reader":false}
```

`{"open":true,...}` means the variable did not reach the server.

## What changes for the reader

The app asks the stand whether it is locked before it asks for anything else. On a locked stand the first screen is one password field, and after that nothing is different: the library, the reading, the marks on the shelves.

The session is a row in the database, not a signed token. That is what makes signing out mean something - the row is deleted, and the token that was in the cookie stops working immediately rather than merely being forgotten by one browser.

It lasts ninety days and every request pushes that back, so a reader who opens the app every few days is never asked again. The reader here is one person on their own phone reaching their own stand; being logged out mid-journey costs more than a stale row in a database on a home network.

The cookie is `HttpOnly` and `SameSite=Lax`, and deliberately not `Secure`: the stand is plain HTTP on a home network, and a `Secure` cookie would never be stored at all - which would mean never staying signed in.

## What a lock does and does not cover

Behind the password: the library index, the shelves, a piece and its text, and everything about reading it. A password that protected the reading state and handed out the text would protect nothing that matters.

In front of it:

- **`GET /api/health`** - a monitor has to be able to ask whether the stand is alive, and the answer says nothing about the content beyond how many pieces there are.
- **`GET`, `POST`, `DELETE /api/session`** - the app has to be able to ask whether it needs a password before it can offer to type one.
- **`POST /api/reindex`** - it is called by a publishing script on the same network, not by a browser. Anyone who can reach it can make the server re-read its own content directory and learn the piece and section counts; it cannot change what is on disk, and it cannot read a piece.

There is one password and one reader. There are no accounts, so there is no user table, nothing to administer, and nothing to leak but the one hash you generated.

This is a lock on a home network, not a public gate: rhapsod is served over plain HTTP and assumes the network around it is yours. Exposing a stand to the open internet is a different problem and needs a TLS terminator in front of it.

## Turning it off

Remove the variable and restart. The stand is open again, every session row keeps working right up until it does not matter, and nothing about your reading is touched - progress and sessions are different tables.

## See also

- [Configuration](/rhapsod/reference/configuration/) - every variable the server reads.
- [API](/rhapsod/reference/api/) - the session endpoints, with real responses.
- [What the reader remembers](/rhapsod/concepts/what-the-reader-remembers/) - what sits behind the gate.
