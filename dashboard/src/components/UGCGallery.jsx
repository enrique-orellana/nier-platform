import React, { useState, useEffect, useRef } from 'react';
import { Film, Download, Copy, Check, ExternalLink, Loader2, Play, User, Sparkles } from 'lucide-react';
import { getApiUrl } from '../config';

export default function UGCGallery() {
  const [tab, setTab] = useState('videos');
  const [videos, setVideos] = useState([]);
  const [avatars, setAvatars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(getApiUrl('/api/saasshorts/gallery?limit=100')).then(r => r.ok ? r.json() : { videos: [] }),
      fetch(getApiUrl('/api/saasshorts/actor-gallery')).then(r => r.ok ? r.json() : { images: [] }),
    ])
      .then(([vData, aData]) => {
        setVideos(vData.videos || []);
        setAvatars(aData.images || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 space-y-4">
        <div className="relative">
          <Loader2 size={32} className="animate-spin text-violet-500" />
          <div className="absolute inset-0 blur-md bg-violet-500/20 rounded-full animate-pulse"></div>
        </div>
        <span className="text-zinc-400 font-medium tracking-wide">Curating your gallery...</span>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 pb-20 space-y-8 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 to-zinc-400">UGC Gallery</h2>
          <p className="text-sm text-zinc-500 mt-1 flex items-center gap-2">
            <span className="flex items-center gap-1"><Film size={14} /> {videos.length} videos</span>
            <span className="w-1 h-1 rounded-full bg-zinc-700"></span>
            <span className="flex items-center gap-1"><User size={14} /> {avatars.length} avatars</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={getApiUrl('/gallery')}
            target="_blank"
            rel="noopener noreferrer"
            className="group px-4 py-2 rounded-full bg-zinc-900 border border-white/5 hover:border-violet-500/30 text-xs font-medium text-zinc-300 transition-all flex items-center gap-2"
          >
            <ExternalLink size={14} className="group-hover:text-violet-400 transition-colors" />
            <span>Public Gallery</span>
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-1.5 bg-black/40 backdrop-blur-xl border border-white/5 rounded-2xl w-fit">
        <button
          onClick={() => setTab('videos')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
            tab === 'videos' 
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20' 
              : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          <Film size={16} />
          Videos
        </button>
        <button
          onClick={() => setTab('avatars')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
            tab === 'avatars' 
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20' 
              : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          <User size={16} />
          Avatars
        </button>
      </div>

      {/* Videos Tab */}
      {tab === 'videos' && (
        videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 border border-dashed border-white/5 rounded-3xl bg-white/[0.02]">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-4 border border-white/5">
              <Film size={24} className="text-zinc-600" />
            </div>
            <p className="text-zinc-400 font-medium">No videos generated yet</p>
            <p className="text-zinc-600 text-sm mt-1">Start by creating your first AI Short</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {videos.map((video) => (
              <VideoCard key={video.video_id} video={video} copied={copied} onCopy={handleCopy} />
            ))}
          </div>
        )
      )}

      {/* Avatars Tab */}
      {tab === 'avatars' && (
        avatars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 border border-dashed border-white/5 rounded-3xl bg-white/[0.02]">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-4 border border-white/5">
              <User size={24} className="text-zinc-600" />
            </div>
            <p className="text-zinc-400 font-medium">No avatars found</p>
            <p className="text-zinc-600 text-sm mt-1">Generate actors to see them here</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {avatars.map((avatar, i) => (
              <AvatarCard key={avatar.key || i} avatar={avatar} copied={copied} onCopy={handleCopy} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function AvatarCard({ avatar, copied, onCopy }) {
  return (
    <div className="group relative flex flex-col rounded-2xl overflow-hidden bg-zinc-900/50 border border-white/[0.05] hover:border-violet-500/50 hover:bg-zinc-900 transition-all duration-500 hover:-translate-y-1 shadow-xl hover:shadow-violet-500/10">
      <div className="aspect-[3/4] overflow-hidden">
        <img 
          src={avatar.url} 
          alt="Avatar" 
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      </div>
      
      <div className="p-3 space-y-2">
        {avatar.description ? (
          <div className="relative group/copy">
            <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed min-h-[2.5em]">{avatar.description}</p>
            <button
              onClick={() => onCopy(avatar.description, `avatar-${avatar.key}`)}
              className="absolute -top-1 -right-1 p-1.5 rounded-lg bg-black/50 text-zinc-500 hover:text-white opacity-0 group-hover/copy:opacity-100 transition-all border border-white/10"
              title="Copy prompt"
            >
              {copied === `avatar-${avatar.key}` ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            </button>
          </div>
        ) : (
          <p className="text-[10px] text-zinc-600 italic min-h-[2.5em]">No prompt data</p>
        )}
        
        <a
          href={avatar.url}
          download
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-white/[0.03] hover:bg-violet-600 text-[10px] font-bold text-zinc-300 hover:text-white transition-all border border-white/[0.05]"
        >
          <Download size={12} />
          Download
        </a>
      </div>
    </div>
  );
}

function VideoCard({ video, copied, onCopy }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const handleMouseEnter = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setPlaying(false);
    }
  };

  const mode = video.video_mode;
  const caption = video.caption || '';
  const hashtags = (video.hashtags || []).join(' ');

  return (
    <div className="group relative flex flex-col rounded-2xl overflow-hidden bg-zinc-900/50 border border-white/[0.05] hover:border-violet-500/50 hover:bg-zinc-900 transition-all duration-500 hover:-translate-y-1 shadow-xl hover:shadow-violet-500/10">
      <div
        className="relative aspect-[9/16] bg-black cursor-pointer overflow-hidden"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <video
          ref={videoRef}
          src={video.video_url}
          poster={video.actor_url}
          muted
          playsInline
          preload="metadata"
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        
        {/* Overlay */}
        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-500 ${playing ? 'opacity-0' : 'opacity-100'}`}>
          <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Play size={24} className="text-white fill-white ml-1" />
          </div>
        </div>

        {/* Status Badge */}
        <div className="absolute top-3 left-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[8px] font-black tracking-tighter backdrop-blur-md border border-white/20 shadow-lg ${
            mode === 'lowcost' 
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
              : 'bg-violet-500/20 text-violet-400 border-violet-500/30'
          }`}>
            <Sparkles size={10} />
            {mode === 'lowcost' ? 'LITE' : 'PRO'}
          </div>
        </div>
        
        {/* Duration Badge */}
        <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[9px] font-bold text-white">
          {video.duration?.toFixed(0)}s
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        <div>
          <h3 className="text-xs font-bold text-zinc-100 truncate group-hover:text-violet-400 transition-colors">{video.title || 'Untitled Video'}</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
            <span className="font-medium text-zinc-400">${video.cost_estimate?.total?.toFixed(2) || '0.00'}</span>
            <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
            <span>UGC Shot</span>
          </p>
        </div>

        {caption && (
          <div className="relative group/copy bg-white/[0.02] p-2 rounded-lg border border-white/[0.03]">
            <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed min-h-[2.5em]">{caption}</p>
            <button
              onClick={() => onCopy(`${caption}\n${hashtags}`, `caption-${video.video_id}`)}
              className="absolute -top-1 -right-1 p-1.5 rounded-lg bg-black/50 text-zinc-500 hover:text-white opacity-0 group-hover/copy:opacity-100 transition-all border border-white/10"
              title="Copy caption"
            >
              {copied === `caption-${video.video_id}` ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            </button>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <a
            href={video.video_url}
            download
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/[0.03] hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 transition-all border border-white/[0.05]"
          >
            <Download size={12} />
            Save
          </a>
          <a
            href={getApiUrl(`/video/${video.video_id}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-[10px] font-bold text-white transition-all shadow-lg shadow-violet-600/10"
          >
            <ExternalLink size={12} />
            Watch
          </a>
        </div>
      </div>
    </div>
  );
}

