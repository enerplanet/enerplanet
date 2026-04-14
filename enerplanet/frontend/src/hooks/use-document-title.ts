import { useEffect } from 'react';

/**
 * Custom hook to update the document title
 * @param title - The title to set for the document
 * @param suffix - Optional suffix to append (defaults to " | SpatialHub")
 */
export function useDocumentTitle(title: string, suffix: string = " | SpatialHub") {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title + suffix;

    // Cleanup: restore previous title when component unmounts
    return () => {
      document.title = previousTitle;
    };
  }, [title, suffix]);
}
