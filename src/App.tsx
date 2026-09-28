import React, { useState, useEffect } from 'react';
import { PanelLeft } from 'lucide-react';
import { Chat } from './components/Chat';
import { Sidebar } from './components/Sidebar';
import { chatManagerInstance, ChatManagerState } from './agent/ChatManager';

export const App: React.FC = () => {
  const [chatState, setChatState] = useState<ChatManagerState>(() =>
    chatManagerInstance.getState()
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const unsubscribe = chatManagerInstance.subscribe((newState) => {
      setChatState(newState);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="app-layout-root">
      <Sidebar
        chats={chatState.chats}
        activeChatId={chatState.activeChatId}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen((prev) => !prev)}
        onSelectChat={(id) => chatManagerInstance.selectChat(id)}
        onCreateChat={() => chatManagerInstance.createChat()}
        onRenameChat={(id, title) => chatManagerInstance.renameChat(id, title)}
        onDeleteChat={(id) => chatManagerInstance.deleteChat(id)}
      />

      <div className={`chat-wrapper ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <Chat
          key={chatState.activeChatId}
          agent={chatState.activeAgent}
        />
      </div>

      {!isSidebarOpen && (
        <button
          type="button"
          className="sidebar-toggle-btn sidebar-expand-float"
          onClick={() => setIsSidebarOpen(true)}
          title="Развернуть панель"
        >
          <PanelLeft size={18} />
        </button>
      )}
    </div>
  );
};

export default App;
