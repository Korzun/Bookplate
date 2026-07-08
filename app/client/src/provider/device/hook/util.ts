import { DeviceList } from '../type';

export const removeDeviceById = (id: string, { [id]: _, ...rest }: DeviceList) => rest;
