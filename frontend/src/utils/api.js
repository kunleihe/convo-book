const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Helper function to handle URL construction
const getFullUrl = (url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    // Ensure we don't have double slashes if base ends with / and url starts with /
    const base = API_BASE_URL.replace(/\/$/, '');
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base}${path}`;
}

// Helper function to make authenticated API requests
export const apiRequest = async (url, options = {}) => {
    const token = localStorage.getItem('authToken');

    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
            ...options.headers,
        },
        ...options,
    };

    // Automatically handle URL prefix
    const fullUrl = getFullUrl(url);
    const response = await fetch(fullUrl, config);

    // If token is invalid, redirect to login
    if (response.status === 401) {
        localStorage.removeItem('authToken');
        window.location.href = '/';
        return;
    }

    return response;
};

// Helper for non-authenticated requests (like public audio files)
export const publicRequest = async (url, options = {}) => {
    const fullUrl = getFullUrl(url);
    return await fetch(fullUrl, options);
};