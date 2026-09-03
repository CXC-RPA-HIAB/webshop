const DriveHelper = {
  saveAttachment: function(attachment, emailId, isValid) {
    const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    let dateFolder = this.getOrCreateFolder(root, today);
    let emailFolder = this.getOrCreateFolder(dateFolder, emailId);
    
    return emailFolder.createFile(attachment.copyBlob());
  },

  getOrCreateFolder: function(parentFolder, folderName) {
    const folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next();
    }
    return parentFolder.createFolder(folderName);
  }
};