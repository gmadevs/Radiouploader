/**
 * Radiopaedia taxonomy values.
 *
 * There is no API endpoint that serves these — `/api/v1/systems` and
 * `/api/v1/diagnostic_certainties` both 404 — so they are transcribed from
 * Radiopaedia's own uploader (radiopaedia/RadiopaediaConnect). The numbering has
 * gaps because retired systems keep their ids. If a case rejects a system id,
 * check that project for changes before assuming a bug here.
 */
export const SYSTEMS: { id: number; name: string }[] = [
  { id: 1, name: 'Breast' },
  { id: 2, name: 'Vascular' },
  { id: 3, name: 'Central Nervous System' },
  { id: 4, name: 'Chest' },
  { id: 6, name: 'Gastrointestinal' },
  { id: 7, name: 'Head & Neck' },
  { id: 8, name: 'Hepatobiliary' },
  { id: 9, name: 'Musculoskeletal' },
  { id: 11, name: 'Urogenital' },
  { id: 12, name: 'Paediatrics' },
  { id: 15, name: 'Spine' },
  { id: 16, name: 'Cardiac' },
  { id: 17, name: 'Interventional' },
  { id: 18, name: 'Obstetrics' },
  { id: 19, name: 'Gynaecology' },
  { id: 20, name: 'Haematology' },
  { id: 21, name: 'Forensic' },
  { id: 22, name: 'Oncology' },
  { id: 23, name: 'Trauma' },
  { id: 24, name: 'Not Applicable' }
]

export const DIAGNOSTIC_CERTAINTIES: { id: number; name: string }[] = [
  { id: 1, name: 'Possible' },
  { id: 2, name: 'Probable' },
  { id: 3, name: 'Almost Certain' },
  { id: 4, name: 'Certain' },
  { id: 5, name: 'Not applicable' }
]

/**
 * The modality values the study endpoint accepts. Anything outside this list is
 * rejected; a blank value is also allowed.
 */
export const MODALITIES: string[] = [
  'CT',
  'DSA (angiography)',
  'Fluoroscopy',
  'MRI',
  'Mammography',
  'Nuclear medicine',
  'Ultrasound',
  'X-ray',
  'Annotated image',
  'Illustration',
  'Pathology',
  'Photograph'
]

/** Map a DICOM Modality value onto Radiopaedia's list, where one exists. */
export function modalityFromDicom(dicomModality: string | null): string {
  switch (dicomModality) {
    case 'CT':
      return 'CT'
    case 'MR':
      return 'MRI'
    case 'US':
      return 'Ultrasound'
    case 'CR':
    case 'DX':
    case 'RG':
      return 'X-ray'
    case 'MG':
      return 'Mammography'
    case 'XA':
    case 'RF':
      return 'DSA (angiography)'
    case 'NM':
    case 'PT':
      return 'Nuclear medicine'
    default:
      return 'CT'
  }
}
