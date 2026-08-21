# The check before anonymising

**Anonymise and continue** does not start straight away.

![The check before anonymising](/shots/06-check.png)

Anonymisation is where a mask stops being an overlay and becomes pixels. After it, going
back means redoing the run — so this is the last moment when erasing something is free.

## Why it is not a tick box

A dialog that asks *"have you checked?"* becomes a reflex by the third import. It moves
responsibility onto the user without giving them anything they did not already have.

So this one **lists**. The app records which stacks were opened full size, and the dialog
names the selected ones that never were, a thumbnail each, every one a click away from the
viewer. Open one, close it, and it has left the list. The count in the header goes down
with it.

When there is nothing left on the list it says so — and still asks. Opening a stack is not
the same as having read every image in it.

## What it will never tell you

It will never call a selection clean.

Nothing in this app looks at the pixels, so a silence would be an absence of evidence
dressed up as a result. In an anonymisation tool that is worse than no check at all,
because it stops people looking. The list is what went **unchecked**, not what is dirty —
and a stack that is missing from it has only been *opened*, which is a proxy for having
looked and no more than that.

Detecting burnt-in text properly would take either an OCR pass or a cheaper heuristic — a
saturated, high-gradient region identical on every frame is almost always an overlay — and
both need decoded pixels, which today rules out exactly the compressed ultrasound where the
banners live. Until then, the honest thing is to ask.
