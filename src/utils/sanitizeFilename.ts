export const sanitizeFilename = (name: string): string =>
    name.replace(/[|&;$%@"<>()+, ]/g, "");