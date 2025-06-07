import React, { useState, useEffect } from 'react';
import './Lightbox.css';

interface GalleryImage {
  src: string;
  description: string;
  date: string;
}

interface LightboxProps {
  image: GalleryImage | null;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

// Navigation Button Component
const NavButton = ({ direction, onClick }: { direction: 'prev' | 'next', onClick: () => void }) => {
  const arrow = direction === 'prev' ? '❮' : '❯';
  const label = direction === 'prev' ? 'Previous' : 'Next';
  
  return (
    <button 
      className={`nav-button ${direction}`} 
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
    >
      {arrow}
    </button>
  );
};

const Lightbox: React.FC<LightboxProps> = ({ 
  image, 
  onClose, 
  onNext, 
  onPrev,
  hasNext,
  hasPrev
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const imgRef = React.useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (image) {
      setIsLoading(true);
      const timer = setTimeout(() => setIsVisible(true), 10);
      document.body.style.overflow = 'hidden';
      
      // Preload the image
      const img = new window.Image();
      img.src = `${process.env.PUBLIC_URL}/images/${image.src}`;
      img.onload = () => {
        setImgSize({ width: img.width, height: img.height });
        setIsLoading(false);
      };
      
      return () => {
        clearTimeout(timer);
        img.onload = null;
      };
    } else {
      setIsVisible(false);
      document.body.style.overflow = 'auto';
    }
  }, [image]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!image) return;
      
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (hasPrev) onPrev();
          break;
        case 'ArrowRight':
          if (hasNext) onNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [image, hasNext, hasPrev, onClose, onNext, onPrev]);

  if (!image) return null;

  // Calculate image dimensions to fit 90% of viewport
  const getImageStyle = () => {
    if (!imgSize.width || !imgSize.height) return {};
    
    const maxWidth = window.innerWidth * 0.9;
    const maxHeight = window.innerHeight * 0.9 - 100; // Account for info area
    
    let width = imgSize.width;
    let height = imgSize.height;
    
    // Scale down if image is larger than viewport
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = width * ratio;
      height = height * ratio;
    }
    
    return { width: `${width}px`, height: `${height}px` };
  };

  return (
    <div 
      className={`lightbox-overlay ${isVisible ? 'show' : ''}`} 
      onClick={onClose}
      tabIndex={-1}
      role="dialog"
      aria-label="Image view"
    >
      <div className="lightbox-content" onClick={e => e.stopPropagation()}>
        <button 
          className="close-button" 
          onClick={onClose}
          aria-label="Close image view"
        >
          &times;
        </button>
        
        <div className="lightbox-image-container">
          {isLoading ? (
            <div className="loading-spinner">Loading...</div>
          ) : (
            <img 
              ref={imgRef}
              src={`${process.env.PUBLIC_URL}/images/${image.src}`} 
              alt={image.description}
              className="lightbox-image"
              loading="eager"
              style={getImageStyle()}
            />
          )}
        </div>
        
        <div className="lightbox-footer">
          <div className="lightbox-navigation">
            {hasPrev && (
              <NavButton direction="prev" onClick={onPrev} />
            )}
            <div className="lightbox-info">
              <p>{image.description}</p>
              <span className="date">{image.date}</span>
            </div>
            {hasNext && (
              <NavButton direction="next" onClick={onNext} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Lightbox);
