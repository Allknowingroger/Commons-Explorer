/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from "@google/genai";

declare const axios: any;
declare const InfiniteScroll: any;

// --- DOM ELEMENTS ---
const searchForm = document.getElementById('searchForm') as HTMLFormElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const resultsContainer = document.getElementById('results') as HTMLDivElement;
const noResultsEl = document.getElementById('no-results') as HTMLDivElement;
const initialLoader = document.getElementById('initial-loader') as HTMLDivElement;

// Lightbox
const lightbox = document.getElementById('lightbox') as HTMLDivElement;
const lightboxImg = document.getElementById('lightbox-img') as HTMLImageElement;
const lightboxTitle = document.getElementById('lightbox-title') as HTMLElement;
const lightboxAuthor = document.getElementById('lightbox-author') as HTMLElement;
const lightboxCloseBtn = document.getElementById('lightbox-close') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLAnchorElement;

// AI Panel Elements
const aiLoader = document.getElementById('ai-loader') as HTMLDivElement;
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const genreButtons = document.querySelectorAll('.genre-btn');
const storyDisplay = document.getElementById('story-display') as HTMLDivElement;
const analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const analysisDisplay = document.getElementById('analysis-display') as HTMLDivElement;
const chatHistory = document.getElementById('chat-history') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const sendChatBtn = document.getElementById('send-chat-btn') as HTMLButtonElement;

// --- STATE ---
const API_URL = 'https://commons.wikimedia.org/w/api.php';
const BATCH_SIZE = 24;
let currentQuery = '';
let gsroffset = 0;
let isLoading = false;
let hasMore = true;
let aiClient: GoogleGenAI | null = null;
let currentImageData: { url: string; title: string; mimeType?: string; base64?: string } | null = null;

// --- UTILITIES ---
const sanitizeHtml = (str: string): string => {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
};

const getAi = () => {
    if (!aiClient) {
        aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return aiClient;
};

const imageUrlToBase64 = async (url: string): Promise<{ mimeType: string; data: string }> => {
    try {
        const response = await axios.get(url, { responseType: 'blob' });
        const blob = response.data;
        const mimeType = blob.type;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const base64String = (reader.result as string).split(',')[1];
                resolve({ mimeType, data: base64String });
            };
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Proxy needed or direct fetch failed", e);
        throw e;
    }
};

const setAiLoading = (loading: boolean) => {
    aiLoader.style.display = loading ? 'flex' : 'none';
};

// --- GEMINI ACTIONS ---

const generateAiContent = async (prompt: string, displayEl: HTMLElement, isChat: boolean = false) => {
    if (!currentImageData) return;
    setAiLoading(true);
    if (!isChat) displayEl.innerHTML = '';
    
    const ai = getAi();
    try {
        // Prepare image data if not already cached for the current session
        if (!currentImageData.base64) {
            const { mimeType, data } = await imageUrlToBase64(currentImageData.url);
            currentImageData.mimeType = mimeType;
            currentImageData.base64 = data;
        }

        const imagePart = {
            inlineData: {
                mimeType: currentImageData.mimeType!,
                data: currentImageData.base64!
            }
        };

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-3-flash-preview',
            contents: { parts: [imagePart, { text: prompt }] },
        });

        let fullText = '';
        const streamContainer = isChat ? document.createElement('div') : displayEl;
        if (isChat) {
            streamContainer.className = 'chat-msg ai-msg';
            displayEl.appendChild(streamContainer);
        }

        for await (const chunk of responseStream) {
            fullText += chunk.text;
            streamContainer.innerText = fullText;
            displayEl.scrollTop = displayEl.scrollHeight;
        }
    } catch (error) {
        console.error('Gemini error:', error);
        displayEl.innerHTML += `<p class="error">AI unavailable: ${error.message}</p>`;
    } finally {
        setAiLoading(false);
    }
};

const handleGenreClick = (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const genre = btn.dataset.genre;
    const prompt = `Write a short, immersive ${genre} story (about 150 words) inspired by this image titled "${currentImageData?.title}". Use vivid sensory details.`;
    generateAiContent(prompt, storyDisplay);
};

const handleAnalyzeClick = () => {
    const prompt = `Analyze this image. Identify the key subjects, the artistic or photographic style, the likely time period or location if applicable, and any interesting hidden details you see. Be concise and use bullet points.`;
    generateAiContent(prompt, analysisDisplay);
};

const handleChatSend = () => {
    const query = chatInput.value.trim();
    if (!query) return;

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user-msg';
    userMsg.innerText = `You: ${query}`;
    chatHistory.appendChild(userMsg);
    
    chatInput.value = '';
    const prompt = `Answer this question about the provided image: ${query}`;
    generateAiContent(prompt, chatHistory, true);
};

// --- TABS LOGIC ---
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = (btn as HTMLElement).dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${target}`)?.classList.add('active');
    });
});

// --- LIGHTBOX LOGIC ---
const openLightbox = (data: { url: string; title: string; author: string; thumb: string }) => {
    currentImageData = { url: data.url, title: data.title };
    
    lightboxImg.src = data.thumb;
    lightboxImg.onload = () => { lightboxImg.src = data.url; };
    
    lightboxTitle.textContent = sanitizeHtml(data.title);
    lightboxAuthor.innerHTML = data.author;
    downloadBtn.href = data.url;

    // Reset AI outputs
    storyDisplay.innerHTML = '<p class="placeholder">Select a style to generate a story...</p>';
    analysisDisplay.innerHTML = '<p class="placeholder">Click to identify objects and context...</p>';
    chatHistory.innerHTML = '<p class="system-msg">Ask Gemini anything about this image.</p>';

    lightbox.classList.add('show');
    document.body.style.overflow = 'hidden';
};

const closeLightbox = () => {
    lightbox.classList.remove('show');
    document.body.style.overflow = '';
    currentImageData = null;
};

// --- WIKIMEDIA LOGIC ---
const makeImageCard = (page: any): HTMLElement => {
    const info = page.imageinfo[0];
    const filename = page.title.replace('File:', '');
    const title = filename.replace(/\.[^/.]+$/, "");
    const author = info.extmetadata?.Artist?.value || `Uploader: ${info.user}`;

    const card = document.createElement('div');
    card.className = 'image-card';
    card.innerHTML = `
        <img src="${info.thumburl}" alt="${sanitizeHtml(title)}" loading="lazy">
        <div class="card-info">
            <h3>${sanitizeHtml(title)}</h3>
        </div>
    `;

    card.addEventListener('click', () => {
        openLightbox({
            url: info.url,
            title,
            author,
            thumb: info.thumburl
        });
    });

    return card;
};

const infScroll = new InfiniteScroll(resultsContainer, {
    path: () => (hasMore && !isLoading ? 'dummy' : undefined),
    append: false,
    history: false,
    status: '.page-load-status',
});

const fetchImages = async () => {
    if (isLoading || !hasMore || !currentQuery) return;
    isLoading = true;

    try {
        const response = await axios.get(API_URL, {
            params: {
                action: 'query', format: 'json', generator: 'search',
                gsrsearch: currentQuery, gsrnamespace: 6, gsrlimit: BATCH_SIZE,
                gsroffset: gsroffset, prop: 'imageinfo', iiprop: 'url|user|extmetadata',
                iiurlwidth: 400, origin: '*',
            },
        });
        
        initialLoader.style.display = 'none';

        if (gsroffset === 0 && !response.data.query) {
            noResultsEl.style.display = 'block';
            hasMore = false;
        } else {
            const pages = response.data.query?.pages;
            if (pages) {
                const items = Object.values(pages).map(page => makeImageCard(page));
                items.forEach(item => resultsContainer.appendChild(item));
            }
        }
        
        if (response.data.continue) {
            gsroffset = response.data.continue.gsroffset;
        } else {
            hasMore = false;
        }
        
    } catch (error) {
        console.error('Fetch error:', error);
        hasMore = false;
        initialLoader.style.display = 'none';
    } finally {
        isLoading = false;
    }
};

const handleSearch = (e?: Event, queryStr?: string) => {
    if (e) e.preventDefault();
    const query = queryStr || searchInput.value.trim();
    if (!query || query === currentQuery) return;

    currentQuery = query;
    gsroffset = 0;
    hasMore = true;
    resultsContainer.innerHTML = '';
    noResultsEl.style.display = 'none';
    initialLoader.style.display = 'flex';
    fetchImages();
};

// --- EVENT LISTENERS ---
searchForm.addEventListener('submit', handleSearch);
infScroll.on('load', fetchImages);
lightboxCloseBtn.addEventListener('click', closeLightbox);
document.querySelector('.lightbox-backdrop')?.addEventListener('click', closeLightbox);

genreButtons.forEach(btn => btn.addEventListener('click', handleGenreClick));
analyzeBtn.addEventListener('click', handleAnalyzeClick);
sendChatBtn.addEventListener('click', handleChatSend);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSend();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('show')) closeLightbox();
});

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    handleSearch(undefined, 'Landscape photography');
});