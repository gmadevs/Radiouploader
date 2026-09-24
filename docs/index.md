---
layout: home

hero:
  name: Radiouploader
  text: Prepare DICOM studies and upload them to Radiopaedia as draft cases
  tagline: Reads a study, splits series that contain more than one acquisition, lets you blank burnt-in text, anonymises the files with Radiopaedia's anonymiser and uploads them.
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
  - title: Series splitting
    details: Series that contain several acquisitions (magnitude and phase, several b-values, echoes, time points) are split into separate stacks, which you can upload or leave out. This happens before anonymisation, which removes the tags used to tell them apart.
    link: /internals/splitting
  - title: Burnt-in text check
    details: The anonymiser removes identifying tags, not text burnt into the images. Before anonymising, the app marks areas that look like text banners. It finds large banners and can miss small or faint text, so check every image yourself.
    link: /guide/check
  - title: Blanking and cropping
    details: Blanked areas are written into the pixel data of every image in the stack, and cropping removes the rest of the image. The image size and patient position tags are updated to match. Compressed images are decoded first.
    link: /guide/review
  - title: Reformats
    details: Coronal and sagittal reformats, and MIP, MinIP or mean slabs of any thickness, added to the case as new series.
    link: /guide/reformat
  - title: DICOM video
    details: MPEG-2, H.264 and HEVC video is decoded into frames, which you can review, blank and crop like any other series. The frames are uploaded as JPEG.
    link: /limitations
  - title: Local processing
    details: Images stay on your computer until you upload them. Temporary files are deleted when the app quits, or at the next launch after a crash. Your Radiopaedia credentials are stored in the system keychain.
    link: /internals/architecture
---

> **Unofficial.** Not affiliated with or endorsed by Radiopaedia.org.

Every screenshot on this site is taken from the running app by `npm run shots`, using a
[synthetic study](/develop/screenshots) generated for the purpose. No patient images appear
anywhere in this repository.
