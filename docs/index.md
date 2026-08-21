---
layout: home

hero:
  name: Radiouploader
  text: DICOM in, a Radiopaedia draft case out
  tagline: Reads a study, splits the series that hold more than one acquisition, lets you blank burnt-in text, anonymises with Radiopaedia's own anonymiser, and uploads.
  image:
    src: /shots/04-viewer.png
    alt: The viewer, with a patient banner burnt into an ultrasound
  actions:
    - theme: brand
      text: Start here
      link: /guide/install
    - theme: alt
      text: How it works
      link: /internals/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/gmadevs/Radiouploader

features:
  - title: Splits what your PACS exported as one series
    details: Magnitude and phase, b-values, echoes, time points — each becomes its own stack you can keep or drop, because the tags that tell them apart are destroyed by anonymisation.
    link: /internals/splitting
  - title: The pixels are your job, and it says so
    details: The anonymiser cleans tags. Text burnt into the image survives it. Erase blanks a region on every image of a stack, and it is painted into the pixel data before upload.
    link: /guide/review
  - title: Nothing leaves the machine until you press Upload
    details: Patient data lives only in the main process, in a temp directory removed on quit. Credentials are entered at runtime and kept in the OS keychain.
    link: /internals/architecture
---

> **Unofficial.** Not affiliated with or endorsed by Radiopaedia.org.

Every screenshot on this site is taken from the running app by `npm run shots`, on a
[synthetic study](/develop/screenshots) generated for the purpose — no patient's images
appear anywhere in this repository.
