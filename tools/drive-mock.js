#!/usr/bin/env node
/**
 * محاكاة بسيطة لخدمتَي DriveApp وUtilities.newBlob تخزّن المحتوى فعليًا
 * (لا كائنات صورية فارغة) — ضرورية لاختبار ملف الترخيص: الرفع (createFile)،
 * القراءة الإدارية (getFileById + getBlob)، والتنظيف عند الفشل (setTrashed).
 */
'use strict';

function createDriveMock() {
  const files = Object.create(null);
  const folders = Object.create(null);
  let seq = 0;

  function fileHandle(id) {
    return {
      getId: () => id,
      getUrl: () => 'https://drive.example/file/' + id,
      setTrashed: value => { files[id].trashed = !!value; },
      isTrashed: () => !!files[id].trashed,
      getBlob: () => ({
        getBytes: () => files[id].bytes,
        getContentType: () => files[id].mimeType
      })
    };
  }

  function folderHandle(id) {
    return {
      getId: () => id,
      getUrl: () => 'https://drive.example/folder/' + id,
      createFile: blob => {
        seq += 1;
        const fileId = 'DRIVE-FILE-' + seq;
        files[fileId] = {
          bytes: blob.getBytes(),
          mimeType: blob.getContentType ? blob.getContentType() : 'application/octet-stream',
          name: blob.getName ? blob.getName() : 'file',
          trashed: false
        };
        return fileHandle(fileId);
      }
    };
  }

  const DriveApp = {
    createFolder: name => {
      seq += 1;
      const folderId = 'DRIVE-FOLDER-' + seq;
      folders[folderId] = { name: name };
      return folderHandle(folderId);
    },
    getFolderById: id => folderHandle(id),
    getFileById: id => {
      if (!files[id]) throw new Error('الملف غير موجود: ' + id);
      return fileHandle(id);
    }
  };

  const newBlob = (bytes, mimeType, name) => ({
    getBytes: () => bytes,
    getContentType: () => mimeType,
    getName: () => name
  });

  return { DriveApp, newBlob, __files: files };
}

module.exports = { createDriveMock };
