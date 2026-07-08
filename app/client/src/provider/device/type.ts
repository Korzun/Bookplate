export type DeviceList = Record<string, Device>;

export type Device = {
  id: string;
  name: string;
  slug: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: 'contain' | 'cover' | 'fill';
  bwCover: boolean;
  simplify: boolean;
};

export type DeviceInput = {
  name: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: 'contain' | 'cover' | 'fill';
  bwCover: boolean;
  simplify: boolean;
};
