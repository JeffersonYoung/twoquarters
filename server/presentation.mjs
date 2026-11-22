// Stored in the project's existing JSON document; legacy projects remain galleries.
export function presentationDraft(value, previous = {}) {
 const presentation = value.presentation ?? previous.presentation ?? 'gallery';
 const longformImageId = value.longformImageId ?? previous.longformImageId ?? '';
 const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
 if (!['gallery', 'longform'].includes(presentation)) fail('无效展示方式');
 if (typeof longformImageId !== 'string') fail('无效正文长图');
 if (longformImageId && !(previous.images || []).some(image => image.id === longformImageId)) fail('请选择本项目的正文长图');
 if (presentation === 'longform' && value.published === true && !longformImageId) fail('请先选择正文长图');
 return { presentation, longformImageId };
}
