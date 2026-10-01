---
title: Reading on the road
description: The reader's side of rhapsod - opening the app, putting it on the home screen, keeping the library on the device, reading without a network, and what to do when a phone goes missing.
sidebar:
  order: 0
---

This page is for the person reading, not the person running the stand. The short version: open the app over `https`, check that **The stand** says **Ready for the road.**, and open the app at home now and then so what you did away reaches the stand.

## Open the app

The address is the stand's `https` address - in these pages, `https://reader.example`. Keep to that one address: the browser holds the offline copy per address, so the same stand opened by another name, or over plain `http`, starts from nothing.

Plain `http` works at home only: browsers keep offline storage for secure pages alone, so such a stand needs [a door](/rhapsod/guides/behind-a-door/) first. A door made with your own certificate authority needs its root trusted once on each device - a new phone included - before the `https` address opens without a warning; the steps for Android and iOS are in [Trusting the root](/rhapsod/guides/behind-a-door/#trusting-the-root-once-per-device).

On a locked stand the first screen is one field, **The password for this library**, and a **Read** button. A session ends only after ninety days unused, so you are rarely asked twice. An open stand never asks; see [Locking a stand](/rhapsod/guides/locking-a-stand/).

## Put it on the home screen

Installed, the reader opens from its own icon. Open the menu - the three lines at the top left, or a swipe in from the left edge - and choose **The stand**. Under **On your screen**:

- Where the browser can install it - Chrome on Android, for one - there is a button, **Put rhapsod on this device**.
- Where it cannot, the screen says how: on iPhone and iPad, **Share**, then **Add to Home Screen**.

On iPhone and iPad the Home Screen app keeps its own storage, apart from Safari's. Open it once at home so it fetches its own copy, and sign in if asked. Anything waiting in Safari stays there, so open the site in Safari at home first.

## Keep the library on the device

**The stand** opens with one sentence - **Ready for the road.** or **Not ready for the road.**, with the reason - and the four checks behind it, in the order they break:

- **a secure connection** - the page came over `https`.
- **an offline reader** - the part that answers without the stand is installed. If not, reloading once usually installs it.
- **the list of what is on the shelves** - without it the app cannot start away from home.
- **the pieces themselves** - every piece on the shelves you keep.

The first time, pieces arrive one by one in the background while the app is open at home; leave early and the next visit carries on.

Under **On this device**, `library` says what is held - `20 of 20 pieces held on 2 of 3 shelves` - and `waiting` how many of your changes have not reached the stand.

### Choose what rides along

**Kept on this device** has a box per shelf. **All of them** is the default and includes shelves added later. Untick it and choose, say, `02 — History` and `19 — Letters`, leaving `01 — Paradoxes` at home; a shelf published later then waits until you tick it. The choice stays on this device.

Shelves you add are fetched in the background. Shelves you remove stay until you press **Fetch the library again**, which refetches every kept piece and drops the rest. Press it before a trip if a piece was edited: away, you read the copy last fetched.

A piece you do not keep is still listed, but away from home it answers *The library is out of reach. It comes back when you are home.*

## Read without a network

Away from the stand, every kept piece opens, and so do **Keep this line** and **Report a misspelling** on a selection, **+ Write a note**, **How it landed**, **Keep this one**, **Mark as read**, and your place in the piece. Each is saved on the device and shown as done at once. **The reading**, the **Journal** and the stand's details need the stand.

Your own marks - read pieces, notes, kept lines, bookmarks, today's cards - come from the stand when the app starts at home, and the device keeps the last of them. Started away from home, the app shows that copy with everything you have done since laid over it. Today's cards are the ones that were due on your last visit home.

A note written away from home never replaces the one the piece already had. The stand keeps any text you had not seen and puts yours after it.

### When changes are delivered

The header counts what waits - `3 kept on this device`. The app delivers it oldest first whenever it sees the stand: on opening, on coming back to the app, when the browser reports a connection, after each new change, and once a minute while the app is open with something waiting. A change the stand refuses is dropped; one it fails to take is retried; one it turns away because the session has ended waits until you sign in again. See [What the reader remembers](/rhapsod/concepts/what-the-reader-remembers/#made-here-delivered-later).

## Before you change devices or stands

Waiting changes live in that browser alone. Before you switch devices, move to a new stand, or clear anything, open the app at home on the device you are leaving and wait until `waiting` on **The stand** reads `nothing`.

Between devices the newer change wins, by the clock of the device that made it; your place in a piece only moves forward. A stand changing address is covered in [Moving a stand](/rhapsod/guides/moving-a-stand/#if-the-new-machine-has-a-different-address).

## Know what can clear the device

The library and the waiting changes are site data. The app asks the browser to keep them rather than clear them when space runs short; the `kept` line on **The stand** says whether it agreed - `until you clear it`, or `until the browser needs the space`. Even then:

- Clearing the browser's data for the site removes both.
- A browser short of space may clear data of sites it considers least used, without asking.
- Safari on iPhone and iPad may remove a site's data after about a week of Safari use without a visit. A Home Screen app counts its own days of use, so reading from the icon protects it.

The library comes back on the next visit home. Only undelivered changes are lost.

## If a device is lost

On a locked stand, **The stand** lists what is **Signed in** - each device, when it signed in and was last used, with **this device** marked. **Sign out everywhere** asks once more - **Sign out all** with the count, or **Keep them** - then ends every session, this one included. This device asks for the password at once, the others when they next reach the stand.

Changes still waiting on the devices you hold are not lost: they wait until you sign in on each, then go.

What it does not do:

- It does not reach the lost device. Its library and its waiting changes stay on it until it is wiped, and away from the stand it still reads. Its copy of your notes and kept lines is cleared the next time it reaches the stand and is turned away.
- It does not change the password. If that browser saved it, make a new hash and restart, as in [Locking a stand](/rhapsod/guides/locking-a-stand/).
- It does nothing on an open stand: there are no sessions to end, and whoever reaches it is the reader. Lock it.
