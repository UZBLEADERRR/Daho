import { useState } from 'react';
import { embedUrl, thumbUrl, type VideoRef } from '../lib/ytube';
import { openExternal } from '../lib/openlink';
import { Play } from './Icons';

/**
 * Chatdagi YouTube havolasi — bosilganda oʻsha yerning oʻzida ochiladi.
 * Pleyer yuklanmasa (tarmoq yoki cheklov) brauzerda ochish tugmasi qoladi.
 */
export function YouTubeCard({ video }: { video: VideoRef }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="yt-frame">
        <iframe
          title="YouTube"
          src={embedUrl(video)}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
        />
        <button className="btn ghost mini wide" onClick={() => openExternal(video.url)}>
          YouTube ilovasida ochish
        </button>
      </div>
    );
  }

  return (
    <button className="yt-card" onClick={() => setPlaying(true)} aria-label="Videoni ochish">
      <img src={thumbUrl(video)} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <span className="yt-play">
        <Play size={22} />
      </span>
      <span className="yt-tag">YouTube</span>
    </button>
  );
}
