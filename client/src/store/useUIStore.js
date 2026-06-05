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
      addAiChatMessage: (msg) => set((state) => ({ aiChatMessages: [...state.aiChatMessages, msg] })),
      clearAiChatMessages: () => set({ aiChatMessages: [] }),
      setAiChatMessages: (messages) => set({ aiChatMessages: messages }),
      
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
        aiChatMessages: state.aiChatMessages.filter(m => !m.isError),
        hasChatted: state.hasChatted,
        isSidebarOpen: state.isSidebarOpen
      }),
    }
  )
);
