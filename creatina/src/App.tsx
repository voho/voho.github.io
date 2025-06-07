import { useState } from 'react';
import './App.css';
import Lightbox from './components/Lightbox/Lightbox';

interface GalleryImage {
  src: string;
  description: string;
  date: Date;
}

// Format date to a readable string (e.g., "May 15, 2024")
const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
};

const images: GalleryImage[] = [
  {
    src: 'k1.jpeg',
    description: 'dummy image',
    date: new Date('2024-05-15')
  },
  {
    src: 'k2.jpeg',
    description: 'dummy image',
    date: new Date('2024-05-20')
  },
  {
    src: 'k3.jpg',
    description: 'dummy image',
    date: new Date('2024-05-25')
  },
  {
    src: 'k4.jpeg',
    description: 'dummy image',
    date: new Date('2024-05-30')
  }
];


// Header Component
const Header = () => (
  <header className="header">
    <h1>Sheep from space</h1>
    <p className="subtitle">
      DUMMY GALLERY
    </p>
  </header>
);

// ImageInfo Component
const ImageInfo = ({ description, date }: { description: string; date: Date }) => (
  <div className="image-info">
    <span>{description}</span>
    <span className="date" title={date.toISOString().split('T')[0]}>
      {formatDate(date)}
    </span>
  </div>
);

// ImageContainer Component
const ImageContainer = ({ src, alt }: { src: string; alt: string }) => (
  <div className="image-container">
    <img 
      src={`${process.env.PUBLIC_URL}/images/${src}`} 
      alt={alt}
      loading="lazy"
    />
  </div>
);



// GalleryItem Component
const GalleryItem = ({ image, index, onClick }: { image: typeof images[number]; index: number; onClick: () => void }) => (
  <div key={index} className="gallery-item" onClick={onClick}>
    <ImageContainer 
      src={image.src} 
      alt={image.description} 
    />
    <ImageInfo description={image.description} date={image.date} />
  </div>
);

// Gallery Component
const Gallery = () => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  
  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < images.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };
  
  const handlePrev = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  return (
    <>
      <main className="gallery">
        {images.map((image, index) => (
          <GalleryItem 
            key={index} 
            image={image} 
            index={index}
            onClick={() => setSelectedIndex(index)}
          />
        ))}
      </main>
      <Lightbox 
        image={selectedIndex !== null ? {
          ...images[selectedIndex],
          date: formatDate(images[selectedIndex].date)
         } : null} 
        onClose={() => setSelectedIndex(null)}
        onNext={handleNext}
        onPrev={handlePrev}
        hasNext={selectedIndex !== null && selectedIndex < images.length - 1}
        hasPrev={selectedIndex !== null && selectedIndex > 0}
      />
    </>
  );
};

// Footer Component
const Footer = () => (
  <footer className="footer">
    <p>© {new Date().getFullYear()} All images are property of Tina. Do not copy or use without permission.</p>
  </footer>
);

// Main App Component
const App = () => {
  return (
    <div className="app">
      <Header />
      <Gallery />
      <Footer />
    </div>
  );
};

export default App;
