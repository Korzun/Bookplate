import { use } from 'react';

import type { UseUploadQueue } from '~/provider/book';

import { UploadContext } from '../context';

export const useUploadQueue = (): UseUploadQueue => use(UploadContext);
