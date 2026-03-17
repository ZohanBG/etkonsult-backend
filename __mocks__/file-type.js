// Manual mock for file-type (ESM-only package)
module.exports = {
  fileTypeFromBuffer: async (buffer) => ({
    ext: 'jpg',
    mime: 'image/jpeg',
  }),
  fileTypeFromFile: async (path) => ({
    ext: 'jpg',
    mime: 'image/jpeg',
  }),
};
