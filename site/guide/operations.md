# Deploys, uptime and self-healing

## Guarded deploys

After a deploy is triggered (or the platform's webhook builds the merge by
itself), Moatline follows the build and watches the live URL. With a
`commit` in the health response it knows exactly when the new build is
serving; a Payload site's `/admin` is checked too. The verdict: healthy,
build failed (the old version keeps running) or broken — and with rollback
on, broken deploys are undone.

## Uptime and incidents

Live URLs are checked every 5 minutes and every minute while they fail. Two
failures in a row open an incident, with the error and the app's latest
log errors as the likely cause. Back up closes it. Uptime over 30 and 90
days per site, and per month in the client report.

## Self-healing

Per repository: after 5 minutes down the app is restarted through its
platform, at most 3 times a day. Still down 10 minutes later — or 30
minutes without self-healing — someone gets a message.

## Errors in the logs

New kinds of errors are grouped by message and counted per hour. One that
comes 20 times within its first hour is sent as a notification, with the
deploy it started after.
