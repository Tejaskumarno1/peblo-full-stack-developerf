import { Folder, Briefcase, BookOpen, House, Heart, Lightbulb, Code, Music, Plane, ShoppingCart, GraduationCap, Camera, Wallet, Coffee, Gamepad2, Dumbbell, Palette, Rocket, Leaf, Star } from 'lucide-react';
import { toneVars } from './folders';

// N13: a small curated set of icons a folder can wear instead of the plain folder. The key is stored as `icon` in the folder
// definition (settings.noteFolders), so an unknown key just shows the plain folder.
export const FOLDER_ICONS = [
  ['folder', 'Folder', Folder], ['briefcase', 'Work', Briefcase], ['book', 'Study', BookOpen], ['home', 'Home', House],
  ['heart', 'Personal', Heart], ['idea', 'Ideas', Lightbulb], ['code', 'Code', Code], ['music', 'Music', Music],
  ['travel', 'Travel', Plane], ['shop', 'Shopping', ShoppingCart], ['school', 'School', GraduationCap], ['photo', 'Photos', Camera],
  ['money', 'Money', Wallet], ['coffee', 'Coffee', Coffee], ['games', 'Games', Gamepad2], ['fitness', 'Fitness', Dumbbell],
  ['art', 'Art', Palette], ['launch', 'Projects', Rocket], ['garden', 'Nature', Leaf], ['star', 'Favourites', Star],
];
export const iconOf = (key) => (FOLDER_ICONS.find((i) => i[0] === key) || FOLDER_ICONS[0])[2];

/** A folder's icon on its coloured chip. The colours switch to the derived dark pair in the dark and midnight themes (see `.fc` in notespanel.css). */
export function FolderChip({ tone, icon, size = 15, className = 'np-swt', style }) {
  const I = iconOf(icon);
  return <span className={`${className} fc`} style={{ ...toneVars(tone), ...style }}><I size={size} strokeWidth={1.8} /></span>;
}

export function IconPicker({ value, tone, onPick }) {
  return (
    <div className="np-icons" role="radiogroup" aria-label="Icon" data-testid="folder-icons">
      {FOLDER_ICONS.map(([k, name, I]) => (
        <button key={k} type="button" role="radio" aria-checked={(value || 'folder') === k} aria-label={name} title={name} className={`fc${(value || 'folder') === k ? ' on' : ''}`} style={toneVars(tone)} onClick={() => onPick(k === 'folder' ? undefined : k)}><I size={16} strokeWidth={1.8} /></button>
      ))}
    </div>
  );
}
