import { create } from 'zustand';

export const useWorkspaceStore = create((set) => ({
  // Note Listing State
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  filterTag: '',
  setFilterTag: (tag) => set({ filterTag: tag }),
  
  sortBy: 'updated',
  setSortBy: (sort) => set({ sortBy: sort }),
  
  showArchived: false,
  setShowArchived: (val) => set({ showArchived: val }),
  
  showDeleted: false,
  setShowDeleted: (val) => set({ showDeleted: val }),

  // UI Panels State
  sidebarOpen: true,
  setSidebarOpen: (val) => set({ sidebarOpen: val }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  aiPanelOpen: false,
  setAiPanelOpen: (val) => set({ aiPanelOpen: val }),
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
  
  isFocusMode: false,
  setFocusMode: (val) => set({ isFocusMode: val }),
  toggleFocusMode: () => set((state) => ({ isFocusMode: !state.isFocusMode })),
  
  showTodoList: false,
  setShowTodoList: (val) => set({ showTodoList: val }),
  
  showBackups: false,
  setShowBackups: (val) => set({ showBackups: val }),
  
  isMobileMenuOpen: false,
  setIsMobileMenuOpen: (val) => set({ isMobileMenuOpen: val }),
  
  isShareModalOpen: false,
  setIsShareModalOpen: (val) => set({ isShareModalOpen: val }),
}));
