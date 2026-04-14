import React, { useState } from "react";
import { Bookmark, Plus, Trash2, MapPin } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Button,
} from "@spatialhub/ui";
import { useMapBookmarksStore, type MapBookmark } from "@/features/interactive-map/store/map-bookmarks";

interface BookmarkMenuProps {
  getCurrentView: () => { latitude: number; longitude: number; zoom: number };
  flyTo: (latitude: number, longitude: number, zoom: number) => void;
}

export const BookmarkMenu: React.FC<BookmarkMenuProps> = ({ getCurrentView, flyTo }) => {
  const { bookmarks, addBookmark, removeBookmark } = useMapBookmarksStore();
  const [isNaming, setIsNaming] = useState(false);
  const [newName, setNewName] = useState("");

  const handleSave = () => {
    if (!newName.trim()) return;
    const view = getCurrentView();
    addBookmark({ name: newName.trim(), ...view });
    setNewName("");
    setIsNaming(false);
  };

  const handleFlyTo = (bookmark: MapBookmark) => {
    flyTo(bookmark.latitude, bookmark.longitude, bookmark.zoom);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 shadow-md"
          aria-label="Map bookmarks"
        >
          <Bookmark className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {isNaming ? (
          <div className="p-2 flex items-center gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setIsNaming(false); setNewName(""); }
              }}
              placeholder="Bookmark name..."
              autoFocus
              className="flex-1 text-sm px-2 py-1 rounded border border-input bg-background focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!newName.trim()}>
              Save
            </Button>
          </div>
        ) : (
          <DropdownMenuItem onClick={() => setIsNaming(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Save current view
          </DropdownMenuItem>
        )}

        {bookmarks.length > 0 && <div className="my-1 h-px bg-border" />}

        {bookmarks.map((bm) => (
          <DropdownMenuItem
            key={bm.id}
            className="flex items-center justify-between group"
            onClick={() => handleFlyTo(bm)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{bm.name}</span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeBookmark(bm.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 transition-opacity"
              aria-label={`Delete ${bm.name}`}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </button>
          </DropdownMenuItem>
        ))}

        {bookmarks.length === 0 && !isNaming && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No bookmarks yet
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
