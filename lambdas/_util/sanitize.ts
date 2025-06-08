import DOMPurify = require('dompurify');

function escapeForJs(input: string): string {
    return input.replace(/'/g, '\\\'').replace(/"/g, '\\"').replace(/\\/g, '\\\\');
}

export function sanitize(input: string) {
    const sanitized = DOMPurify.sanitize(input, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
    }).trim();
    return escapeForJs(sanitized);
}