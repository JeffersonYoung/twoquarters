import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationDraft } from '../server/presentation.mjs';

test('legacy projects keep gallery rendering; unrelated updates preserve longform selection', () => {
 assert.deepEqual(presentationDraft({}), { presentation: 'gallery', longformImageId: '' });
 const previous = { presentation: 'longform', longformImageId: 'body', images: [{ id: 'cover' }, { id: 'body' }] };
 assert.deepEqual(presentationDraft({ published: true }, previous), { presentation: 'longform', longformImageId: 'body' });
 assert.deepEqual(presentationDraft({ presentation: 'gallery', longformImageId: '' }, previous), { presentation: 'gallery', longformImageId: '' });
});

test('longform must reference an owned image and cannot publish an empty body', () => {
 assert.throws(() => presentationDraft({ presentation: 'unknown' }), { status: 400 });
 assert.throws(() => presentationDraft({ longformImageId: 42 }), { status: 400 });
 assert.throws(() => presentationDraft({ longformImageId: 'another-project-image' }, { images: [{ id: 'cover' }] }), { status: 400 });
 assert.throws(() => presentationDraft({ presentation: 'longform', published: true }), { status: 400 });
 assert.deepEqual(presentationDraft({ presentation: 'longform' }), { presentation: 'longform', longformImageId: '' });
});
