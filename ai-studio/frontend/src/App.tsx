import { useState, useEffect, useRef } from 'react';
import './App.css';

// ВЫНЕСЛИ IP СЮДА. Если захочешь зайти с планшета, поменяй 'localhost' на свой IP (например, '192.168.0.13')
const API_BASE_URL = 'http://localhost:3000';

type Chat = { id: string; aiId: string; title: string; date: string; system_prompt?: string; };
type Message = { id: string; role: 'user' | 'assistant'; content: string; };

function App() {
  const [models, setModels] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeAiId, setActiveAiId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [typingText, setTypingText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('Печатает...');

  const [showPepsi, setShowPepsi] = useState(false);
  const [pepsiTimer, setPepsiTimer] = useState(30);
  const [useSearch, setUseSearch] = useState(false);

  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchModelName, setLaunchModelName] = useState('');

  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const duckBufferRef = useRef<AudioBuffer | null>(null);

  useEffect(() => {
    document.body.className = theme;
  }, [theme]);

  const getDisplayName = (modelName: string) => {
    const customNames = JSON.parse(localStorage.getItem('modelNames') || '{}');
    return customNames[modelName] || modelName;
  };

  const handleRenameModel = (e: React.MouseEvent, modelName: string) => {
    e.stopPropagation();
    const currentName = getDisplayName(modelName);
    const newName = window.prompt('Введите красивое название для модели:', currentName);
    
    if (newName && newName.trim() && newName !== currentName) {
      const customNames = JSON.parse(localStorage.getItem('modelNames') || '{}');
      customNames[modelName] = newName;
      localStorage.setItem('modelNames', JSON.stringify(customNames));
      setModels([...models]);
    }
  };

  const handleSelectModel = (modelName: string) => {
    setActiveAiId(modelName);
    localStorage.setItem('lastAiId', modelName);
    const firstChat = chats.find(c => c.aiId === modelName);
    setActiveChatId(firstChat ? firstChat.id : null);
  };

  const handleOpenLaunchModal = (e: React.MouseEvent, modelName: string) => {
    e.stopPropagation();
    setLaunchModelName(modelName);
    setShowLaunchModal(true);
  };

  const handleLaunchModel = async () => {
    setShowLaunchModal(false);
    try {
      await fetch(`${API_BASE_URL}/api/ollama/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName: launchModelName })
      });
    } catch (e) {
      console.error('Ошибка запуска');
    }
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/ollama/models`)
      .then(r => r.json())
      .then(data => {
        setModels(data.sort());
        const lastAi = localStorage.getItem('lastAiId');
        if (lastAi && data.includes(lastAi)) {
          setActiveAiId(lastAi);
        }
      })
      .catch(() => console.log('Ollama не запущена'));

    fetch(`${API_BASE_URL}/api/chats`).then(r => r.json()).then(data => {
      setChats(data);
    });

    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    fetch('/duck.mp3').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(b => { duckBufferRef.current = b; }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      setPromptText('');
      return;
    }

    fetch(`${API_BASE_URL}/api/chats/${activeChatId}/messages`)
      .then(r => r.json())
      .then(data => {
        setMessages(data);
        const chat = chats.find(c => c.id === activeChatId);
        setPromptText(chat?.system_prompt || '');
      })
      .catch(() => setMessages([]));
  }, [activeChatId, chats]);

  useEffect(() => {
    if (!isTyping) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isTyping]);

  useEffect(() => {
    let interval: any;
    if (showPepsi && pepsiTimer > 0) {
      interval = setInterval(() => { setPepsiTimer(prev => prev - 1); }, 1000);
    }
    return () => clearInterval(interval);
  }, [showPepsi, pepsiTimer]);

  const handleNewChat = async () => {
    if (!activeAiId) {
      alert('Сначала выберите модель в правой панели!');
      return;
    }
    const newChat: Chat = { id: Date.now().toString(), aiId: activeAiId, title: 'Новый чат', date: 'Сегодня' };
    await fetch(`${API_BASE_URL}/api/chats`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newChat)
    });
    setChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
  };

  const handleHideChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    if (audioCtxRef.current && duckBufferRef.current) {
      try {
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = duckBufferRef.current;
        source.loop = true;
        source.connect(audioCtxRef.current.destination);
        source.start(0, 0.7); 
        setTimeout(() => { source.stop(); }, 3000);
      } catch (e) {}
    }
    await fetch(`${API_BASE_URL}/api/chats/${chatId}/hide`, { method: 'POST' });
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (activeChatId === chatId) setActiveChatId(null);
  };

  const handleRenameChat = async (e: React.MouseEvent, chat: Chat) => {
    e.stopPropagation();
    const newTitle = window.prompt('Введите новое название чата:', chat.title);
    
    if (newTitle && newTitle.trim() && newTitle !== chat.title) {
      setChats(prev => prev.map(c => c.id === chat.id ? { ...c, title: newTitle } : c));
      try {
        const res = await fetch(`${API_BASE_URL}/api/chats/${chat.id}/title`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle })
        });
        if (!res.ok) setChats(prev => prev.map(c => c.id === chat.id ? { ...c, title: chat.title } : c));
      } catch (err) {
        setChats(prev => prev.map(c => c.id === chat.id ? { ...c, title: chat.title } : c));
      }
    }
  };

  const handleSavePrompt = async () => {
    if (!activeChatId) return;
    setShowPromptModal(false);
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, system_prompt: promptText } : c));
    await fetch(`${API_BASE_URL}/api/chats/${activeChatId}/prompt`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: promptText })
    });
  };

  const handleSendMessage = async (e?: any) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    let currentAi = activeAiId;
    if (!currentAi && models.length > 0) {
      currentAi = models[0];
      setActiveAiId(currentAi);
      localStorage.setItem('lastAiId', currentAi);
    }

    if (!currentAi) {
      alert('Нет доступных моделей!');
      return;
    }

    let currentChatId = activeChatId;
    if (!currentChatId) {
      const newChat: Chat = { id: Date.now().toString(), aiId: currentAi, title: 'Новый чат', date: 'Сегодня' };
      await fetch(`${API_BASE_URL}/api/chats`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newChat)
      });
      setChats(prev => [newChat, ...prev]);
      currentChatId = newChat.id;
      setActiveChatId(currentChatId);
    }

    const userText = inputText;
    setInputText('');
    setIsLoading(true);
    setIsTyping(false);
    setTypingText('');

    const lowerText = userText.toLowerCase();
    const isMichaelText = lowerText.includes('майкл') || lowerText.includes('джексон') || lowerText.includes('michael') || lowerText.includes('billie jean') || lowerText.includes('thriller') || lowerText.includes('smooth criminal');
    const isPepsiText = lowerText.includes('пепси') || lowerText.includes('pepsi');
    
    if (isMichaelText && isPepsiText) setStatusText('наливаю Пепси...');
    else if (isMichaelText || isPepsiText) setStatusText('иду к базе данных лунной походкой...');
    else setStatusText('Печатает...');

    const currentChat = chats.find(c => c.id === currentChatId);
    if (currentChat && currentChat.title === 'Новый чат') {
      const newTitle = userText.length > 25 ? userText.substring(0, 25) + '...' : userText;
      setChats(prev => prev.map(c => c.id === currentChatId ? { ...c, title: newTitle } : c));
      fetch(`${API_BASE_URL}/api/chats/${currentChatId}/title`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle })
      }).catch(() => {});
    }

    setMessages(prev => [...prev, { id: 'temp-user', role: 'user', content: userText }]);

    try {
      const res = await fetch(`${API_BASE_URL}/api/chats/${currentChatId}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userText, aiId: currentAi, useSearch })
      });

      if (!res.ok) throw new Error('Ошибка сервера');
      const data = await res.json();
      
      if (data.success) {
        try {
          if (data.isPepsi) { setShowPepsi(true); setPepsiTimer(30); }
          if (data.isArchitect) new Audio('/architect.mp3').play().catch(() => {});
          if (data.isBread) { const a = new Audio('/tf2.mp3'); a.currentTime = 27; a.play().catch(() => {}); }
          if (data.isOffended) new Audio('/no.mp3').play().catch(() => {});
        } catch (e) {}

        const fullText = data.aiMessage || '';
        
        setIsTyping(true);
        let currentText = '';
        
        for (let i = 0; i < fullText.length; i++) {
          currentText += fullText[i];
          if (i % 2 === 0 || i === fullText.length - 1) {
            setTypingText(currentText);
            await new Promise(resolve => setTimeout(resolve, 15));
          }
        }

        setMessages(prev => [...prev, { id: 'final-ai', role: 'assistant', content: fullText }]);
        setIsTyping(false);
        setTypingText('');

      } else {
        throw new Error(data.error || 'Неизвестная ошибка');
      }
    } catch (error: any) {
      new Audio('/ow.mp3').play().catch(() => {});
      setMessages(prev => [...prev, { id: 'err', role: 'assistant', content: '⚠️ ' + error.message }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo-area" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
          <div>
            <h2>AI Studio</h2>
            <div className="logo-row"><span className="by-text">by</span><img src="/ds.webp" alt="DeepSeek" className="logo-img" /></div>
          </div>
          <button 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', opacity: 0.7, paddingTop: '5px' }}
            title="Сменить тему"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
        
        <button type="button" className="new-chat-btn" onClick={handleNewChat}>+ Новый чат</button>
        <div className="history-list">
          {chats.filter(c => c.aiId === activeAiId).map(chat => (
            <div key={chat.id} className={`history-item ${activeChatId === chat.id ? 'active' : ''}`} onClick={() => setActiveChatId(chat.id)}>
              <span 
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                onDoubleClick={(e) => handleRenameChat(e, chat)}
              >
                {chat.title}
              </span>
              <button onClick={(e) => handleHideChat(e, chat.id)} className="delete-chat-btn">×</button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '15px', padding: '10px', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          <strong>⚠️ Дисклеймер:</strong> Мы изо всех сил пытаемся сдерживать патриотический дух вашей модели, но он очень сильный. Если она выдала текст на китайском — просто скопируйте его в переводчик. Она не со зла.
        </div>
        <div style={{ marginTop: '10px', padding: '10px', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          <strong>🧠 Дисклеймер 2:</strong> Если у вас любая ИИ на 7 млрд параметров, она может быть очень тупой, даже используя Википедию. Не пытайтесь её обучить. Мы не ручаемся, что она будет умной.
        </div>
      </aside>

      <main className="chat-area">
        {activeChatId ? (
          <div className="chat-active">
            <div className="messages-container">
              {messages.map((msg, i) => (
                <div key={i} className={`msg-row ${msg.role}`}>
                  <div className="msg-content">{msg.content}</div>
                </div>
              ))}
              
              {isTyping && (
                <div className="msg-row assistant">
                  <div className="msg-content">{typingText}</div>
                </div>
              )}

              {isLoading && !isTyping && (
                <div className="msg-row assistant">
                  <div className="msg-content">{statusText}</div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <div className="welcome-screen">
            <img src="/lamp.png" alt="Logo" className="welcome-svg-logo" />
            <h1>Привет! Выберите чат слева или начните печатать.</h1>
          </div>
        )}

        <div className="input-wrapper">
          <form className="input-box" onSubmit={handleSendMessage}>
            <textarea 
              placeholder="Сообщение..." 
              value={inputText} 
              onChange={e => setInputText(e.target.value)} 
              disabled={isLoading || isTyping}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
            ></textarea>
            <div className="input-tools">
              <div className="tool-tags">
                <span className="tag" style={{ cursor: 'default' }}><span className="icon">🧠</span> Глубокое мышление <small style={{ opacity: 0.6, fontSize: '10px' }}>не добавим</small></span>
                <span className="tag" onClick={() => setUseSearch(!useSearch)} style={{ background: useSearch ? 'var(--accent-light)' : 'var(--bg-card)', cursor: 'pointer' }}>🌐 Тупой поиск</span>
              </div>
              <div className="action-buttons">
                <button type="button" onClick={() => setShowFeedbackModal(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', marginRight: '5px', display: 'flex', alignItems: 'center' }} title="Обратная связь">
                  <img src="/tg.webp" alt="Telegram" style={{ width: '22px', height: '22px', opacity: 0.7 }} />
                </button>
                <button type="button" onClick={() => setShowPromptModal(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', opacity: 0.6, marginRight: '5px' }} title="Настройки характера">⚙️</button>
                <button type="submit" className="send-btn" style={{ background: inputText.trim() && !isLoading && !isTyping ? 'var(--accent)' : 'var(--border)' }}>↑</button>
              </div>
            </div>
          </form>
        </div>
      </main>

      <aside className="right-sidebar">
        <h3>Выбор Ассистента</h3>
        <div className="assistant-list">
          {models.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Ollama не запущена или нет моделей</p>}
          {models.map(modelName => (
            <div 
              key={modelName} 
              className={`assistant-item ${activeAiId === modelName ? 'active' : ''}`} 
              onClick={() => handleSelectModel(modelName)} 
              title="Клик — выбрать модель"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span className="assistant-name">{getDisplayName(modelName)}</span>
              
              <button 
                onClick={(e) => handleRenameModel(e, modelName)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.5, padding: '0 5px', fontSize: '14px' }}
                title="Переименовать"
              >
                ✏️
              </button>

              <button 
                onClick={(e) => handleOpenLaunchModal(e, modelName)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.5, padding: '0 5px', fontSize: '14px' }}
                title="Запустить"
              >
                ▶️
              </button>
            </div>
          ))}
        </div>
      </aside>

      {showLaunchModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Запуск модели</h3>
            <p>Проверьте команду для запуска:</p>
            <input type="text" value={`ollama run ${launchModelName}`} readOnly style={{ width: '100%', padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-main)', fontFamily: 'monospace', marginBottom: '20px', outline: 'none' }} />
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowLaunchModal(false)}>Отмена</button>
              <button type="button" className="btn-launch" onClick={handleLaunchModel}>Запустить</button>
            </div>
          </div>
        </div>
      )}

      {showPromptModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>
              Настройки характера 
              <span style={{ fontSize: '10px', background: 'var(--accent)', color: 'white', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px', verticalAlign: 'middle' }}>
                BETA
              </span>
            </h3>
            <p>Опишите, как ИИ должен себя вести.</p>
            <textarea style={{ width: '100%', height: '80px', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '15px', fontFamily: 'inherit', background: 'var(--bg-card)', color: 'var(--text-main)' }} value={promptText} onChange={e => setPromptText(e.target.value)} placeholder="Например: 'Я в своём сознании настолько преисполнился...'" />
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowPromptModal(false)}>Отмена</button>
              <button type="button" className="btn-launch" onClick={handleSavePrompt}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {showFeedbackModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <img src="/tg.webp" alt="Telegram" style={{ width: '50px', height: '50px', marginBottom: '15px' }} />
            <h3>У вас проблемы/баги/велосипеды?</h3>
            <p style={{ marginBottom: '20px' }}>Пишите в Telegram <a href="https://t.me/prokhozh" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 'bold' }}>@prokhozh</a>, и мы все оперативно починим (или хотя бы посмеемся).</p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>А если у вас нет Telegram, то на голодный желудок пишите в <a href="https://github.com/AIStudioDevsTeam/AI-Studio/issues" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Issues на GitHub</a>. Но не факт, что ответим, но посмеемся точно.</p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-launch" onClick={() => setShowFeedbackModal(false)}>Понятно</button>
            </div>
          </div>
        </div>
      )}

      {showPepsi && (
        <div style={{ position: 'fixed', inset: 0, background: 'black', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <video src="/pepsi.mp4" autoPlay style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <div style={{ position: 'absolute', bottom: '40px', right: '40px' }}>
            {pepsiTimer > 0 ? <p style={{ color: 'white', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '5px' }}>Пропустить через {pepsiTimer} сек...</p> : <button onClick={() => setShowPepsi(false)} style={{ padding: '10px 20px', background: 'red', color: 'white', borderRadius: '5px', border: 'none', cursor: 'pointer' }}>Пропустить</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;