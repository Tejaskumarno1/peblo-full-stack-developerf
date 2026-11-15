// @mentions in notes are stored as a markdown link: [@Name](peblo-user:<userId>).
// The editor shows a chip; every other reader (preview, shared page, exports) turns the link into a <span class="pb-mention"> first,
// because the sanitiser would strip a link with an unknown address scheme.
import { escapeHtml } from './safeHtml';

export const MENTION_MD = /\[@([^\]\n]{1,80})\]\(peblo-user:([\w-]{4,64})\)/g;
export const MENTION_HREF = /^peblo-user:([\w-]{4,64})$/;

/** The text a mention shows: the name without characters that would break the markdown link. */
export const mentionText = (name) => `@${String(name || 'Someone').replace(/[[\]()\n]/g, '').trim().slice(0, 80) || 'Someone'}`;

/** Markdown -> markdown where each mention becomes a span chip (run before marked). */
export const mentionsToHtml = (md) => String(md ?? '').replace(MENTION_MD, (_m, name, id) => `<span class="pb-mention" data-user="${escapeHtml(id)}">@${escapeHtml(name)}</span>`);
