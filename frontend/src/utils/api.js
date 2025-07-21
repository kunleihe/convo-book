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

    const response = await fetch(url, config);

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
    return await fetch(url, options);
};