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

// --- Auth ---
export const login = async (username, password) => {
    const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    if (!response.ok) throw new Error('Login failed');
    return response.json();
};

// --- Books ---
export const getBooks = async () => {
    const response = await apiRequest('/api/books');
    if (!response.ok) throw new Error('Failed to fetch books');
    return response.json();
};

export const getBookDetails = async (bookId) => {
    const response = await apiRequest(`/api/books/${bookId}`);
    if (!response.ok) throw new Error('Failed to fetch book details');
    return response.json();
};

// --- S3 Upload Flow ---

/**
 * 1. Get Presigned URL from Backend
 * metadata: { filename, content_type, book_id, page_number, stage, username }
 */
export const getUploadUrl = async (metadata) => {
    const response = await apiRequest('/api/upload-url', {
        method: 'POST',
        body: JSON.stringify(metadata)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to get upload URL');
    }
    return response.json(); // returns { upload_url, key }
};

/**
 * 2. Upload File directly to S3
 * Note: This does NOT use apiRequest because it goes to AWS, not our backend.
 */
export const uploadToS3 = async (presignedUrl, file) => {
    const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: {
            'Content-Type': file.type // Must match what was sent to getUploadUrl
        }
    });

    if (!response.ok) {
        throw new Error(`S3 Upload failed: ${response.statusText}`);
    }
    return true;
};

// --- Conversations ---
export const saveConversation = async (data) => {
    // data should include: book_id, page_number, text, sender, username, etc.
    const response = await apiRequest('/api/conversations/', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to save conversation');
    return response.json();
};