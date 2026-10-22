import type { FC, ChangeEvent } from 'react';
import { X, Plus } from 'lucide-react';

interface Step1MetadataProps {
  title: string;
  setTitle: (v: string) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  tagInput: string;
  setTagInput: (v: string) => void;
}

const Step1Metadata: FC<Step1MetadataProps> = ({
  title, setTitle, tags, setTags, tagInput, setTagInput,
}) => {
  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-4">
      {/* Location Name */}
      <div>
        <label htmlFor="loc-name" className="block text-sm font-medium text-foreground mb-1.5">
          Location Name *
        </label>
        <input
          id="loc-name"
          type="text"
          value={title}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          placeholder="Enter a name for your location"
          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-background dark:bg-gray-700 text-foreground text-sm transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">Give your location a descriptive name</p>
      </div>

      {/* Tags */}
      <div>
        <label htmlFor="tag-input" className="block text-sm font-medium text-foreground mb-1.5">
          Tags (optional)
        </label>
        <div className="flex gap-2">
          <input
            id="tag-input"
            type="text"
            placeholder="Add a tag..."
            value={tagInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
            className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-background dark:bg-gray-700 text-foreground text-sm transition-colors"
          />
          <button type="button" onClick={handleAddTag} className="px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors">
            <Plus className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded text-xs text-foreground">
                {tag}
                <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Step1Metadata;
