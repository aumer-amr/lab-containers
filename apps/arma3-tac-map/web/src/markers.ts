export const markerShapes = [
  ['mil_dot', 'Dot'], ['mil_objective', 'Objective'], ['mil_warning', 'Warning'], ['mil_start', 'Start'],
  ['mil_end', 'End'], ['mil_pickup', 'Pick up'], ['mil_destroy', 'Destroy'], ['mil_ambush', 'Ambush'],
  ['mil_arrow', 'Arrow'], ['mil_circle', 'Circle'], ['mil_box', 'Square'], ['mil_triangle', 'Triangle'],
  ['mil_flag', 'Flag'], ['mil_unknown', 'Unknown'],
] as const

export const markerColors = [
  ['ColorBlack', 'Black'], ['ColorGrey', 'Grey'], ['ColorRed', 'Red'], ['ColorBrown', 'Brown'],
  ['ColorOrange', 'Orange'], ['ColorYellow', 'Yellow'], ['ColorKhaki', 'Khaki'], ['ColorGreen', 'Green'],
  ['ColorBlue', 'Blue'], ['ColorPink', 'Pink'], ['ColorWhite', 'White'], ['ColorUNKNOWN', 'Unknown'],
  ['colorBLUFOR', 'BLUFOR'], ['colorOPFOR', 'OPFOR'], ['colorIndependent', 'Independent'], ['colorCivilian', 'Civilian'],
] as const

const validShapes = new Set<string>(markerShapes.map(([value]) => value))
const validColors = new Set<string>(markerColors.map(([value]) => value))

export function markerImageURL(icon: string, color: string) {
  const safeIcon = validShapes.has(icon) ? icon : 'mil_dot'
  const safeColor = validColors.has(color) ? color : 'ColorBlack'
  return `/markers/${safeColor.toLowerCase()}/${safeIcon}.png`
}
