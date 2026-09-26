export const coloredWoolVoxels = {
  OrangeWool: 74,
  MagentaWool: 75,
  LightBlueWool: 76,
  YellowWool: 77,
  LimeWool: 78,
  PinkWool: 79,
  GrayWool: 80,
  LightGrayWool: 81,
  CyanWool: 82,
  PurpleWool: 83,
  BlueWool: 84,
  BrownWool: 85,
  GreenWool: 86,
  RedWool: 87,
  BlackWool: 88,
} as const;

export const coloredWoolFaceMaterials = {
  OrangeWool: 78,
  MagentaWool: 79,
  LightBlueWool: 80,
  YellowWool: 81,
  LimeWool: 82,
  PinkWool: 83,
  GrayWool: 84,
  LightGrayWool: 85,
  CyanWool: 86,
  PurpleWool: 87,
  BlueWool: 88,
  BrownWool: 89,
  GreenWool: 90,
  RedWool: 91,
  BlackWool: 92,
} as const;

export const woolVoxelColors = [
  ['white', '白色', 60, 63, '#e8e8df'],
  ['orange', '橙色', coloredWoolVoxels.OrangeWool, coloredWoolFaceMaterials.OrangeWool, '#d97819'],
  ['magenta', '品红色', coloredWoolVoxels.MagentaWool, coloredWoolFaceMaterials.MagentaWool, '#b24aac'],
  ['light-blue', '淡蓝色', coloredWoolVoxels.LightBlueWool, coloredWoolFaceMaterials.LightBlueWool, '#6699d8'],
  ['yellow', '黄色', coloredWoolVoxels.YellowWool, coloredWoolFaceMaterials.YellowWool, '#c9b51a'],
  ['lime', '黄绿色', coloredWoolVoxels.LimeWool, coloredWoolFaceMaterials.LimeWool, '#74a82d'],
  ['pink', '粉红色', coloredWoolVoxels.PinkWool, coloredWoolFaceMaterials.PinkWool, '#d98199'],
  ['gray', '灰色', coloredWoolVoxels.GrayWool, coloredWoolFaceMaterials.GrayWool, '#4c5355'],
  ['light-gray', '淡灰色', coloredWoolVoxels.LightGrayWool, coloredWoolFaceMaterials.LightGrayWool, '#9aa1a1'],
  ['cyan', '青色', coloredWoolVoxels.CyanWool, coloredWoolFaceMaterials.CyanWool, '#2f8b8d'],
  ['purple', '紫色', coloredWoolVoxels.PurpleWool, coloredWoolFaceMaterials.PurpleWool, '#7043a3'],
  ['blue', '蓝色', coloredWoolVoxels.BlueWool, coloredWoolFaceMaterials.BlueWool, '#334f9b'],
  ['brown', '棕色', coloredWoolVoxels.BrownWool, coloredWoolFaceMaterials.BrownWool, '#70462a'],
  ['green', '绿色', coloredWoolVoxels.GreenWool, coloredWoolFaceMaterials.GreenWool, '#446b25'],
  ['red', '红色', coloredWoolVoxels.RedWool, coloredWoolFaceMaterials.RedWool, '#a83232'],
  ['black', '黑色', coloredWoolVoxels.BlackWool, coloredWoolFaceMaterials.BlackWool, '#202428'],
] as const;

export type WoolColorId = (typeof woolVoxelColors)[number][0];
export const woolVoxelForColor = Object.freeze(
  Object.fromEntries(woolVoxelColors.map(([id, , voxel]) => [id, voxel])),
) as Readonly<Record<WoolColorId, number>>;
export const woolFaceMaterialForVoxel = Object.freeze(
  Object.fromEntries(woolVoxelColors.map(([, , voxel, material]) => [voxel, material])),
) as Readonly<Record<number, number>>;
