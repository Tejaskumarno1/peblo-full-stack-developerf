import '../styles/profiles.css'; // the picture's size rule must load with the picture, or it draws at full size
// A person's picture, or their initial when they have none. Fills its parent (the parent sets size and shape).
export default function Avatar({ src, fallback, alt = '' }) {
  if (src) return <img className="pb-avatar-img" src={src} alt={alt} draggable="false" />;
  return <>{fallback}</>;
}
