# The check before anonymising

**Anonymise and continue** does not start straight away.

![The check before anonymising](/shots/06-check.png)

Anonymisation is where a mask stops being an overlay and becomes pixels. After it, going
back means redoing the run — so this is the last moment when erasing something is free.

## Why it is not a tick box

A dialog that asks *"have you checked?"* becomes a reflex by the third import. It moves
responsibility onto the user without giving them anything they did not already have.

So this one **looks, and lists**.

It reads two images of every selected series — the middle one and the one furthest from it —
and rings anything that looks like burnt-in text. Those series come first, with the reason
underneath. The test is what an overlay is: pixels at the ends of the range, hard edges, and
above all *still* — the anatomy moves between two images of a series and a banner does not.
An area you have already blanked is not looked at, so it does not come back at you.

`BurnedInAnnotation` (0028,0301) is reported too when a file declares it. Only a **YES**
means anything; exporters leave it absent or set it to NO out of habit.

Below that it **lists**: the app records which stacks were opened full size, and the dialog
names the selected ones that never were, a thumbnail each, every one a click away from the
viewer. Open one, close it, and it has left the list.

When there is nothing left on the list it says so — and still asks. Opening a stack is not
the same as having read every image in it.

## What it will never tell you

It will never call a selection clean.

The check finds obvious banners. It does not find small print, text over anatomy,
low-contrast overlays, or anything on the images it did not read — and it is not OCR, so it
does not know what it has found. **Silence about a series means nothing was noticed in it**,
which is a much smaller claim than nothing being there, and in an anonymisation tool the
difference matters: a clean bill stops people looking.

So the dialog reports two things and neither is a verdict. What was **noticed**, ringed on
the picture. And what went **unopened**, which is a proxy for having looked and no more than
that. Everything else it leaves to you, and still asks.
