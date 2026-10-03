import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import type { ProjectImage } from "../data";

export function Lightbox({
  images,
  index,
  onChange,
  onClose,
}: {
  images: ProjectImage[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onChange((index + 1) % images.length);
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [images.length, index, onChange, onClose]);

  const image = images[index];

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="作品大图">
      <button className="lightbox-backdrop" type="button" aria-label="关闭大图" onClick={onClose} />
      <div className="lightbox-toolbar">
        <span>{String(index + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X aria-hidden="true" />
        </button>
      </div>
      <button
        className="lightbox-arrow lightbox-prev"
        type="button"
        aria-label="上一张"
        onClick={() => onChange((index - 1 + images.length) % images.length)}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <figure className="lightbox-figure">
        <img src={image.src} alt={image.alt} />
        <figcaption>{image.alt}{image.credit ? ` · ${image.credit}` : ""}</figcaption>
      </figure>
      <button
        className="lightbox-arrow lightbox-next"
        type="button"
        aria-label="下一张"
        onClick={() => onChange((index + 1) % images.length)}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}
