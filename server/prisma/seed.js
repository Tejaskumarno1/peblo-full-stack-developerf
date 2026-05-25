import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.aiGeneration.deleteMany();
  await prisma.noteTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.note.deleteMany();
  await prisma.user.deleteMany();

  // Create demo user
  const passwordHash = await bcrypt.hash('demo123', 12);
  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email: 'demo@peblo.dev',
      passwordHash
    }
  });
  console.log(`  ✅ Created user: ${user.email} (password: demo123)`);

  // Create tags
  const tagNames = ['work', 'personal', 'ideas', 'meeting', 'project', 'todo', 'research', 'design'];
  const tags = {};
  for (const name of tagNames) {
    tags[name] = await prisma.tag.create({ data: { name } });
  }
  console.log(`  ✅ Created ${tagNames.length} tags`);

  // Create notes
  const notesData = [
    {
      title: 'Sprint Planning Notes — Week 22',
      content: `## Sprint Goals\n\n- Complete user authentication module\n- Design dashboard wireframes\n- Set up CI/CD pipeline\n\n## Discussion Points\n\n1. **API Design**: Need to finalize the REST API structure for the notes endpoint. Considering using PATCH instead of PUT for partial updates.\n\n2. **Database**: PostgreSQL vs SQLite for development. Decision: Use SQLite for local dev, PostgreSQL for production.\n\n3. **AI Integration**: Research Gemini API capabilities for note summarization.\n\n## Action Items\n\n- [ ] Draft API documentation\n- [ ] Set up Prisma migrations\n- [ ] Create component library\n- [ ] Review PR #42`,
      category: 'Work',
      tagNames: ['work', 'meeting', 'project'],
      isPublic: true,
      shareId: 'demo-sprint'
    },
    {
      title: 'React Performance Optimization',
      content: `# React Performance Tips\n\n## 1. Memoization\n\nUse \`React.memo\` for components that render frequently with the same props.\n\n\`\`\`jsx\nconst MemoizedComponent = React.memo(({ data }) => {\n  return <div>{data.map(item => <Item key={item.id} {...item} />)}</div>;\n});\n\`\`\`\n\n## 2. useCallback & useMemo\n\n- **useCallback**: Memoize function references to prevent unnecessary re-renders\n- **useMemo**: Memoize expensive computations\n\n## 3. Code Splitting\n\nUse \`React.lazy\` and \`Suspense\` for route-based code splitting.\n\n## 4. Virtual Lists\n\nFor large lists (1000+ items), use \`react-window\` or \`react-virtuoso\`.\n\n> The key insight: measure first, optimize second. Use React DevTools Profiler.`,
      category: 'Learning',
      tagNames: ['research', 'work']
    },
    {
      title: 'Book List 2025',
      content: `## Currently Reading\n\n- **"Designing Data-Intensive Applications"** by Martin Kleppmann\n  - Chapter 7: Transactions\n  - Great insights on distributed systems\n\n## To Read\n\n1. "The Pragmatic Programmer" — Hunt & Thomas\n2. "Clean Architecture" — Robert C. Martin\n3. "System Design Interview" — Alex Xu\n4. "Atomic Habits" — James Clear\n5. "Deep Work" — Cal Newport\n\n## Completed ✅\n\n- "You Don't Know JS" series\n- "Eloquent JavaScript"\n- "The Art of PostgreSQL"`,
      category: 'Personal',
      tagNames: ['personal', 'ideas']
    },
    {
      title: 'AI Feature Brainstorm',
      content: `# AI Features for Peblo Notes\n\n## Core Features (MVP)\n\n1. **Auto-Summary**: Generate 2-3 sentence summary of any note\n2. **Action Item Extraction**: Pull out actionable tasks from meeting notes\n3. **Title Suggestion**: Suggest concise titles based on content\n\n## Future Ideas\n\n- **Smart Tags**: Auto-suggest tags based on content analysis\n- **Related Notes**: Find similar notes using embeddings\n- **Writing Assistant**: Grammar and tone suggestions\n- **Translation**: Multi-language support\n- **Voice Notes**: Speech-to-text transcription\n\n## Technical Considerations\n\n- Use Google Gemini API (free tier: 15 RPM)\n- Cache AI results in database to avoid re-generation\n- Show loading states during AI processing\n- Graceful fallback when API is unavailable`,
      category: 'Work',
      tagNames: ['ideas', 'project', 'research']
    },
    {
      title: 'Weekly Grocery List',
      content: `## Produce\n- Avocados (3)\n- Bananas\n- Spinach\n- Tomatoes\n- Bell peppers\n\n## Protein\n- Chicken breast (2 lb)\n- Salmon fillets\n- Eggs (dozen)\n- Greek yogurt\n\n## Pantry\n- Olive oil\n- Brown rice\n- Pasta\n- Canned tomatoes\n- Almonds\n\n## Snacks\n- Dark chocolate\n- Trail mix\n- Hummus\n\n**Budget**: ~$80`,
      category: 'Personal',
      tagNames: ['personal', 'todo']
    },
    {
      title: 'Design System Color Tokens',
      content: `# Peblo Design System — Colors\n\n## Background Layers\n\n| Token | Hex | Usage |\n|-------|-----|-------|\n| bg-primary | #09090f | Main background |\n| bg-secondary | #111118 | Cards, sidebar |\n| bg-tertiary | #1a1a26 | Inputs, nested |\n| bg-elevated | #222233 | Modals, tooltips |\n\n## Accent Palette\n\n- Primary: \`#7c3aed\` (Purple 600)\n- Light: \`#a78bfa\` (Purple 400)\n- Dark: \`#5b21b6\` (Purple 800)\n\n## Semantic Colors\n\n- Success: \`#22c55e\`\n- Warning: \`#f59e0b\`\n- Error: \`#ef4444\`\n- Info: \`#3b82f6\`\n\n> Design principle: Dark mode first, with subtle glassmorphism and gradient accents.`,
      category: 'Work',
      tagNames: ['design', 'project']
    }
  ];

  // Handle 'design' tag that might not exist yet
  if (!tags['design']) {
    tags['design'] = await prisma.tag.create({ data: { name: 'design' } });
  }

  for (const noteData of notesData) {
    const note = await prisma.note.create({
      data: {
        userId: user.id,
        title: noteData.title,
        content: noteData.content,
        category: noteData.category,
        isPublic: noteData.isPublic || false,
        shareId: noteData.shareId || null
      }
    });

    // Associate tags
    for (const tagName of noteData.tagNames) {
      if (tags[tagName]) {
        await prisma.noteTag.create({
          data: { noteId: note.id, tagId: tags[tagName].id }
        });
      }
    }
  }
  console.log(`  ✅ Created ${notesData.length} demo notes`);

  // Create some AI generation records for demo
  const firstNote = await prisma.note.findFirst({ where: { userId: user.id } });
  if (firstNote) {
    await prisma.aiGeneration.createMany({
      data: [
        {
          noteId: firstNote.id,
          userId: user.id,
          type: 'summary',
          result: JSON.stringify({ summary: 'Sprint planning notes covering authentication, dashboard design, and CI/CD setup with action items for API documentation and Prisma migrations.' })
        },
        {
          noteId: firstNote.id,
          userId: user.id,
          type: 'action_items',
          result: JSON.stringify({ action_items: ['Draft API documentation', 'Set up Prisma migrations', 'Create component library', 'Review PR #42'] })
        }
      ]
    });
    console.log('  ✅ Created sample AI generations');
  }

  console.log('\n🎉 Seeding complete!');
  console.log('   Login: demo@peblo.dev / demo123\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
