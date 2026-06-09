import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUIStore = create(
  persist(
    (set) => ({
      // AI Chat Panel State
      isAiChatOpen: false,
      toggleAiChat: () => set((state) => ({ isAiChatOpen: !state.isAiChatOpen })),
      setAiChatOpen: (isOpen) => set({ isAiChatOpen: isOpen }),
      
      aiChatMessages: [],
      addAiChatMessage: (msg) => set((state) => ({ 
        aiChatMessages: Array.isArray(state.aiChatMessages) ? [...state.aiChatMessages, msg] : [msg] 
      })),
      clearAiChatMessages: () => set({ aiChatMessages: [] }),
      setAiChatMessages: (messages) => set((state) => {
        const nextMessages = typeof messages === 'function' ? messages(state.aiChatMessages) : messages;
        return { aiChatMessages: Array.isArray(nextMessages) ? nextMessages : [] };
      }),
      
      hasChatted: false,
      setHasChatted: (hasChatted) => set({ hasChatted }),

      // Sidebar State
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
    }),
    {
      name: 'peblo-ui-storage',
      partialize: (state) => ({ 
        aiChatMessages: Array.isArray(state.aiChatMessages) ? state.aiChatMessages.filter(m => m && !m.isError) : [],
        hasChatted: state.hasChatted,
        isSidebarOpen: state.isSidebarOpen
      }),
    }
  )
);
