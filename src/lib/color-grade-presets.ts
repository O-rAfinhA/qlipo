export type ColorGradePreset = {
  id: string;
  label: string;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
};

export const COLOR_GRADE_PRESETS: ColorGradePreset[] = [
  { id: "neutral",     label: "Neutro",         brightness: 1,    contrast: 1,    saturation: 1,    blur: 0   },
  { id: "cinematic",   label: "Cinematográfico", brightness: 0.92, contrast: 1.2,  saturation: 0.75, blur: 0   },
  { id: "warm",        label: "Quente",          brightness: 1.05, contrast: 1.1,  saturation: 1.3,  blur: 0   },
  { id: "cold",        label: "Frio",            brightness: 0.95, contrast: 1.05, saturation: 0.75, blur: 0   },
  { id: "vintage",     label: "Vintage",         brightness: 0.88, contrast: 0.9,  saturation: 0.55, blur: 0.6 },
  { id: "bw",          label: "P&B",             brightness: 1,    contrast: 1.15, saturation: 0,    blur: 0   },
];
