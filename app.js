import { auth, db } from './firebase.js';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
    onAuthStateChanged
} from "firebase/auth";
import {
    collection, addDoc, query, orderBy, onSnapshot, doc, setDoc, getDoc,
    serverTimestamp, where, getDocs, limit
} from "firebase/firestore";

// ---------- DOM ----------
const authContainer   = document.getElementById('auth-container');
const chatApp         = document.getElementById('chat-app');
const loginForm       = document.getElementById('login-form');
const signupForm      = document.getElementById('signup-form');
const loginTab        = document.getElementById('login-tab');
const signupTab       = document.getElementById('signup-tab');
const loginError      = document.getElementById('login-error');
const signupError     = document.getElementById('signup-error');
const messagesList    = document.getElementById('messages-list');
const messageInput    = document.getElementById('message-input');
const sendBtn         = document.getElementById('send-btn');
const logoutBtn       = document.getElementById('logout-btn');
const usernameDisplay = document.getElementById('username-display');
const emojiBtn        = document.getElementById('emoji-btn');
const emojiPicker     = document.getElementById('emoji-picker');
const chatTitle       = document.getElementById('chat-title');
const chatSubtitle    = document.getElementById('chat-subtitle');
const usersListEl     = document.getElementById('users-list');
const usersSearch     = document.getElementById('users-search');
const tabGlobal       = document.getElementById('tab-global');
const tabInbox        = document.getElementById('tab-inbox');
const sidebar         = document.getElementById('sidebar');
const sidebarToggle   = document.getElementById('sidebar-toggle');
const unreadTotal     = document.getElementById('unread-total');

const GROUP_ID = "global_chat";
let currentUser       = null;
let currentUserData   = null;
let unsubscribeMessages = null;
let unsubscribeUsers  = null;
let unsubscribeInbox  = null;
let currentMode       = 'global';   // 'global' | 'inbox'
let currentPeerId     = null;       // DM peer uid
let currentPeerName   = null;
let allUsers          = [];
let inboxUnread       = {};         // { uid: count }
let peerProfiles      = {};         // cache

// ---------- Helpers ----------
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
}

function timeAgo(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return d.toLocaleDateString();
}

function chatIdFor(a, b) {
    return [a, b].sort().join('__');
}

function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
}

function avatarColor(uid) {
    const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
}

// ---------- Auth tabs ----------
loginTab.addEventListener('click', () => {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
});
signupTab.addEventListener('click', () => {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupForm.classList.add('active');
    loginForm.classList.remove('active');
});

// ---------- Signup ----------
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    signupError.innerText = '';
    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', userCred.user.uid), {
            displayName: name,
            email: email,
            createdAt: serverTimestamp()
        });
    } catch (err) {
        signupError.innerText = err.code + " : " + err.message;
    }
});

// ---------- Login ----------
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    loginError.innerText = '';
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        loginError.innerText = err.message;
    }
});

// ---------- Logout ----------
logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
});

// ---------- Emoji ----------
emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
});
document.querySelectorAll('#emoji-picker span').forEach(span => {
    span.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoji = span.innerText;
        messageInput.value = emoji;
        emojiPicker.classList.add('hidden');
        await sendMessage();
    });
});
document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.classList.add('hidden');
    }
});

// ---------- Mode switching ----------
tabGlobal.addEventListener('click', () => switchMode('global'));
tabInbox.addEventListener('click', () => switchMode('inbox'));

async function switchMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    tabGlobal.classList.toggle('active', mode === 'global');
    tabInbox.classList.toggle('active', mode === 'inbox');

    if (mode === 'global') {
        currentPeerId = null;
        currentPeerName = null;
        chatTitle.innerText = '🌍 Global Chat';
        chatSubtitle.innerText = 'Everyone can see messages here';
        await subscribeGlobal();
    } else {
        chatTitle.innerText = '📥 Inbox';
        chatSubtitle.innerText = 'Select a user to start chatting';
        chatSubtitle.innerText = 'Pick a user from the sidebar';
        messagesList.innerHTML = '<div class="empty-msg">👈 Select a user from the sidebar to start a private chat</div>';
        if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    }
}

// ---------- Global chat subscribe ----------
async function subscribeGlobal() {
    if (unsubscribeMessages) unsubscribeMessages();
    const messagesRef = collection(db, 'groups', GROUP_ID, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const msgs = [];
        snapshot.forEach(d => msgs.push({ id: d.id, ...d.data() }));
        renderMessages(msgs);
        autoScroll();
    });
}

// ---------- DM subscribe ----------
async function openDM(peerId, peerName) {
    currentMode = 'inbox';
    tabGlobal.classList.remove('active');
    tabInbox.classList.add('active');

    currentPeerId = peerId;
    currentPeerName = peerName;
    chatTitle.innerText = `💬 ${peerName}`;
    chatSubtitle.innerText = 'Private conversation';

    // reset unread for this peer
    inboxUnread[peerId] = 0;
    updateUnreadBadge();
    renderUsersList(usersSearch.value);

    if (unsubscribeMessages) unsubscribeMessages();
    const cid = chatIdFor(currentUser.uid, peerId);
    const messagesRef = collection(db, 'chats', cid, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const msgs = [];
        snapshot.forEach(d => msgs.push({ id: d.id, ...d.data() }));
        renderMessages(msgs);
        autoScroll();
        // mark incoming as seen (update readBy)
        snapshot.docs.forEach(async (d) => {
            const data = d.data();
            if (data.senderId !== currentUser.uid && data.seen !== true) {
                try { await setDoc(d.ref, { seen: true }, { merge: true }); } catch(e){}
            }
        });
    });
}

// ---------- Render messages ----------
function renderMessages(messages) {
    if (!messagesList) return;
    if (messages.length === 0) {
        messagesList.innerHTML = '<div class="empty-msg">✨ No messages yet. Say something!</div>';
        return;
    }
    messagesList.innerHTML = '';
    let lastSender = null;
    messages.forEach(msg => {
        const isOwn = msg.senderId === currentUser?.uid;
        const sameSender = lastSender === msg.senderId;
        lastSender = msg.senderId;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
        const senderName = msg.senderName || (isOwn ? 'You' : 'Someone');
        const time = msg.timestamp
            ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
            : '';

        messageDiv.innerHTML = `
            ${!sameSender && !isOwn ? `<div class="message-sender">${escapeHtml(senderName)}</div>` : ''}
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-time">${time}${isOwn && msg.seen ? ' ✓✓' : ''}</div>
        `;
        messagesList.appendChild(messageDiv);
    });
}

function autoScroll() {
    const area = document.getElementById('messages-area');
    if (area) area.scrollTop = area.scrollHeight;
}

// ---------- Send message ----------
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;

    const displayName = currentUserData?.displayName || currentUser.email.split('@')[0];

    if (currentMode === 'global') {
        await addDoc(collection(db, 'groups', GROUP_ID, 'messages'), {
            text, senderId: currentUser.uid, senderName: displayName,
            timestamp: serverTimestamp()
        });
    } else if (currentPeerId) {
        const cid = chatIdFor(currentUser.uid, currentPeerId);
        const chatRef = doc(db, 'chats', cid);
        const chatSnap = await getDoc(chatRef);
        if (!chatSnap.exists()) {
            await setDoc(chatRef, {
                participants: [currentUser.uid, currentPeerId],
                participantsInfo: {
                    [currentUser.uid]: { name: displayName },
                    [currentPeerId]: { name: currentPeerName || 'User' }
                },
                createdAt: serverTimestamp(),
                lastMessage: text,
                lastSender: currentUser.uid,
                lastUpdated: serverTimestamp()
            });
        } else {
            await setDoc(chatRef, {
                lastMessage: text,
                lastSender: currentUser.uid,
                lastUpdated: serverTimestamp()
            }, { merge: true });
        }

        await addDoc(collection(db, 'chats', cid, 'messages'), {
            text, senderId: currentUser.uid, senderName: displayName,
            seen: false, timestamp: serverTimestamp()
        });
    }

    messageInput.value = '';
    messageInput.focus();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// ---------- Users list ----------
async function subscribeUsers() {
    const usersRef = collection(db, 'users');
    unsubscribeUsers = onSnapshot(usersRef, (snap) => {
        allUsers = [];
        snap.forEach(d => {
            if (d.id !== currentUser.uid) {
                const data = d.data();
                allUsers.push({
                    uid: d.id,
                    name: data.displayName || data.email?.split('@')[0] || 'User',
                    email: data.email || ''
                });
                peerProfiles[d.id] = data.displayName || data.email?.split('@')[0];
            }
        });
        renderUsersList(usersSearch.value);
    });

    // subscribe inbox for unread
    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid));
    unsubscribeInbox = onSnapshot(q, (snap) => {
        inboxUnread = {};
        snap.forEach(d => {
            const data = d.data();
            const other = data.participants.find(p => p !== currentUser.uid);
            if (other && data.lastSender && data.lastSender !== currentUser.uid) {
                // mark as unread (count simple = 1 if not currently open)
                if (!(currentMode === 'inbox' && currentPeerId === other)) {
                    inboxUnread[other] = (inboxUnread[other] || 0) + 1;
                }
            }
        });
        updateUnreadBadge();
        renderUsersList(usersSearch.value);
    });
}

function updateUnreadBadge() {
    const total = Object.values(inboxUnread).reduce((a,b)=>a+b,0);
    if (total > 0) {
        unreadTotal.innerText = total;
        unreadTotal.classList.remove('hidden');
    } else {
        unreadTotal.classList.add('hidden');
    }
}

function renderUsersList(filter = '') {
    if (!usersListEl) return;
    const f = filter.trim().toLowerCase();
    const filtered = allUsers.filter(u =>
        u.name.toLowerCase().includes(f) || u.email.toLowerCase().includes(f)
    );

    // Section: Global Chat
    let html = `
        <div class="user-section-title">Channels</div>
        <div class="user-item global-item ${currentMode==='global'?'active':''}" data-global="1">
            <div class="avatar" style="background: linear-gradient(135deg,#6366f1,#8b5cf6)">🌍</div>
            <div class="user-meta">
                <div class="user-name">Global Chat</div>
                <div class="user-sub">Everyone</div>
            </div>
        </div>
        <div class="user-section-title">Direct Messages</div>
    `;

    if (filtered.length === 0) {
        html += `<div class="no-users">No users found</div>`;
    } else {
        filtered.forEach(u => {
            const unread = inboxUnread[u.uid] || 0;
            const isActive = currentMode === 'inbox' && currentPeerId === u.uid;
            html += `
                <div class="user-item ${isActive?'active':''}" data-uid="${u.uid}" data-name="${escapeHtml(u.name)}">
                    <div class="avatar" style="background:${avatarColor(u.uid)}">${escapeHtml(initials(u.name))}</div>
                    <div class="user-meta">
                        <div class="user-name">${escapeHtml(u.name)}</div>
                        <div class="user-sub">${escapeHtml(u.email)}</div>
                    </div>
                    ${unread > 0 ? `<div class="unread-dot">${unread}</div>` : ''}
                </div>
            `;
        });
    }

    usersListEl.innerHTML = html;

    // attach events
    usersListEl.querySelectorAll('.user-item').forEach(el => {
        el.addEventListener('click', () => {
            if (el.dataset.global) {
                switchMode('global');
            } else {
                openDM(el.dataset.uid, el.dataset.name);
                if (window.innerWidth < 800) sidebar.classList.add('collapsed');
            }
        });
    });
}

usersSearch.addEventListener('input', (e) => renderUsersList(e.target.value));

sidebarToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
});

// ---------- Auth state ----------
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        authContainer.classList.add('hidden');
        chatApp.classList.remove('hidden');

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            currentUserData = userDoc.data();
        } else {
            currentUserData = { displayName: user.email.split('@')[0] };
        }
        usernameDisplay.innerText = currentUserData.displayName || user.email.split('@')[0];

        // ensure group exists
        const groupRef = doc(db, 'groups', GROUP_ID);
        const groupSnap = await getDoc(groupRef);
        if (!groupSnap.exists()) {
            await setDoc(groupRef, {
                name: "Global Chat",
                createdAt: serverTimestamp()
            });
        }

        await subscribeUsers();
        await switchMode('global');
    } else {
        if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
        if (unsubscribeUsers)    { unsubscribeUsers();    unsubscribeUsers = null; }
        if (unsubscribeInbox)    { unsubscribeInbox();    unsubscribeInbox = null; }
        currentUser = null;
        currentUserData = null;
        currentPeerId = null;
        currentMode = 'global';
        authContainer.classList.remove('hidden');
        chatApp.classList.add('hidden');
    }
});
