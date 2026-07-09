"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface BannerCarouselProps {
  urls: string[];
}

export function BannerCarousel({ urls }: BannerCarouselProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % urls.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [urls.length]);

  if (!urls.length) return null;

  return (
    <div className="relative aspect-[16/7] w-full overflow-hidden rounded-2xl bg-[var(--color-accent)] md:aspect-[21/9] lg:rounded-3xl">
      <img
        src={urls[index]}
        alt="Banner"
        className="h-full w-full object-cover transition-opacity duration-500"
      />
      {urls.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + urls.length) % urls.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-1 text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => (i + 1) % urls.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-1 text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {urls.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-white" : "bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
