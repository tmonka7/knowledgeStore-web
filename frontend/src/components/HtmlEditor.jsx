import { Editor } from '@tinymce/tinymce-react';

import 'tinymce/tinymce';
import 'tinymce/models/dom';
import 'tinymce/themes/silver';
import 'tinymce/icons/default';
import 'tinymce/skins/ui/oxide/skin.min.css';
import 'tinymce/plugins/table';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/link';
import 'tinymce/plugins/image';
import 'tinymce/plugins/code';

import contentCss from 'tinymce/skins/content/default/content.min.css?raw';
import contentUiCss from 'tinymce/skins/ui/oxide/content.min.css?raw';

export default function HtmlEditor({ value, onChange, height = 320 }) {
  return (
    <Editor
      value={value || ''}
      onEditorChange={(content) => onChange?.(content)}
      init={{
        license_key: 'gpl',
        skin: false,
        content_css: false,
        content_style: [contentCss, contentUiCss].join('\n'),
        height,
        menubar: false,
        plugins: 'table lists link image code',
        toolbar: [
          'undo redo | blocks fontfamily fontsize',
          'bold italic underline strikethrough | forecolor backcolor',
          'alignleft aligncenter alignright alignjustify',
          'bullist numlist outdent indent | blockquote',
          'table link image | code removeformat',
        ].join(' | '),
        // Keep pasted markup byte-for-byte: every element, every attribute,
        // including inline style, class, and full table structure.
        valid_elements: '*[*]',
        valid_children: '+body[style]',
        paste_data_images: true,
        paste_webkit_styles: 'all',
        paste_merge_formats: false,
        table_default_attributes: {},
        table_default_styles: {},
      }}
    />
  );
}
