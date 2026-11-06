import { ImageStore } from "./engine/images";

/** App-wide image cache shared by the preview, thumbnails and the exporter. */
export const images = new ImageStore();
