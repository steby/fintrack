import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions cap request bodies at 1MB by default — below Phase 5's own
      // MAX_CSV_BYTES (5MB) cap in lib/domain/csv.ts, so an oversized upload was
      // hitting Next's hard 413 before ever reaching that check's graceful, friendly
      // error message. Set well above 5MB, not just barely above it: MAX_CSV_BYTES
      // measures JS string .length (UTF-16 code units), which can undercount the
      // real UTF-8 wire size by up to ~3x for non-Latin item/category text — a file
      // that legitimately passes the graceful 5MB check could otherwise still exceed
      // a tightly-set platform limit and hit Next's raw error anyway. 20MB covers
      // that worst case with room to spare for FormData/multipart overhead and the
      // sibling column-mapping fields submitted alongside the CSV text.
      bodySizeLimit: '20mb',
    },
  },
};

export default nextConfig;
