// ==UserScript==
// @name         GitHub Add View-State to File Tree
// @namespace    https://www.bjss.com/
// @version      0.1.0
// @description  Adds functionality relating to the view-state to the file tree on PR files
// @author       Thomas Bickley (thomas.bickley@ba.com)
// @match        https://github.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const namespace = 'ghvsft'; // GitHub View-State File Tree

    const CHECK_STATE_UNCHECKED = 0;
    const CHECK_STATE_PARTIAL = 0.5;
    const CHECK_STATE_CHECKED = 1;

    class FileInfo {
        constructor(fileId, parentDirectoryId, checkboxId, checkState) {
            this.fileId = fileId;
            this.parentDirectoryId = parentDirectoryId;
            this.checkboxId = checkboxId;
            this.isPending = checkState === undefined;
            this.isChecked = checkState === CHECK_STATE_CHECKED;
        }

        getCheckState() {
            return this.isChecked ? CHECK_STATE_CHECKED : CHECK_STATE_UNCHECKED;
        }

        setInitialIsChecked(isChecked) {
            if (!this.isPending) {
                console.warn('setInitialIsChecked called on non-pending file');
                return;
            }

            this.isPending = false;
            this.isChecked = isChecked;

            const checkbox = this.getCheckbox();
            checkbox.checked = isChecked;
            checkbox.disabled = false;
            checkbox.classList.remove(namespace + '-pending');

            this.getParentDirectory()?.onChildCheckStateUpdate(undefined, this.getCheckState());
        }

        setIsChecked(isChecked) {
            const oldCheckState = this.getCheckState();
            this.isChecked = isChecked;

            const checkbox = this.getCheckbox();
            checkbox.checked = isChecked;

            this.getParentDirectory()?.onChildCheckStateUpdate(oldCheckState, this.getCheckState());
        }

        getCheckbox() {
            return document.getElementById(this.checkboxId);
        }

        getGitHubCheckbox() {
            return document.getElementById('diff-' + this.fileId)
                ?.getElementsByClassName('js-reviewed-checkbox')[0];
        }

        getParentDirectory() {
            return directoryInfoMap[this.parentDirectoryId];
        }
    }

    class DirectoryInfo {
        constructor(parentDirectoryId, checkboxId) {
            this.parentDirectoryId = parentDirectoryId;
            this.checkboxId = checkboxId;
            this.checkState = CHECK_STATE_UNCHECKED;
            this.childCheckStateTotal = 0;
            this.pendingChildCount = 0;
            this.isPending = false;
            this.totalChildCount = 0;
            this.directoryChildIds = [];
            this.fileChildIds = [];
        }

        getCheckState() {
            return this.checkState;
        }

        getCheckbox() {
            return document.getElementById(this.checkboxId);
        }

        getParentDirectory() {
            return directoryInfoMap[this.parentDirectoryId];
        }
        
        addChildFile(fileInfo) {
            this.childCheckStateTotal += fileInfo.getCheckState();
            this.pendingChildCount += fileInfo.isPending ? 1 : 0;
            this.totalChildCount++;
            this.fileChildIds.push(fileInfo.fileId);

            this.refreshIsPending();
            this.refreshCheckState();
        }

        addChildDirectory(directoryId, checkState) {
            this.childCheckStateTotal += checkState;
            this.totalChildCount++;
            this.directoryChildIds.push(directoryId);
        }

        onChildIsPendingUpdate(oldIsPending, newIsPending) {
            this.pendingChildCount -= oldIsPending ? 1 : 0;
            this.pendingChildCount += newIsPending ? 1 : 0;

            this.refreshIsPending();
        }

        onChildCheckStateUpdate(oldCheckState, newCheckState) {
            if (oldCheckState === undefined) {
                this.pendingChildCount -= 1;
            } else {
                this.childCheckStateTotal -= oldCheckState;
            }
            this.childCheckStateTotal += newCheckState;

            this.refreshIsPending();
            this.refreshCheckState();
        }

        refreshIsPending() {
            const oldIsPending = this.isPending;
            this.isPending = this.pendingChildCount !== 0;

            if (this.isPending !== oldIsPending) {
                const checkbox = this.getCheckbox();
                if (this.isPending) {
                    checkbox.disabled = true;
                    checkbox.classList.add(namespace + '-pending');
                } else {
                    checkbox.disabled = false;
                    checkbox.classList.remove(namespace + '-pending');
                }

                // Notify parent
                this.getParentDirectory()?.onChildIsPendingUpdate(oldIsPending, this.isPending);
            }
        }

        refreshCheckState() {
            const oldCheckState = this.checkState;
            this.checkState = this.childCheckStateTotal === this.totalChildCount
                ? CHECK_STATE_CHECKED
                : (
                    this.childCheckStateTotal === 0
                    ? CHECK_STATE_UNCHECKED
                    : CHECK_STATE_PARTIAL
                );

            if (this.checkState !== oldCheckState) {
                const checkbox = this.getCheckbox();
                if (this.checkState === CHECK_STATE_CHECKED) {
                    checkbox.checked = true;
                    checkbox.classList.remove(namespace + '-partial');
                } else if (this.checkState === CHECK_STATE_UNCHECKED) {
                    checkbox.checked = false;
                    checkbox.classList.remove(namespace + '-partial');
                } else if (this.checkState === CHECK_STATE_PARTIAL) {
                    // Partial is unchecked, because the action for clicking it should be to set it to 'checked'
                    checkbox.checked = false;
                    checkbox.classList.add(namespace + '-partial');
                }

                // Notify parent
                this.getParentDirectory()?.onChildCheckStateUpdate(oldCheckState, this.checkState);
            }
        }
    }

    let fileInfoMap = {};
    let directoryInfoMap = {};

    let directoryIdIndex = 0;

    /**
     * Inject a CSS snippet into the page
     *
     * @param css the CSS
     */
    function injectCss(css) {
        const styleNode = document.createElement('style');

        styleNode.textContent = css;

        document.head.appendChild(styleNode);
    }

    function closestAncestor(node, func) {
        while (node) {
            if (func(node)) {
                return node;
            }
            node = node.parentNode;
        }

        return null;
    }

    function getPrId() {
        const match = document.location.pathname.match(/pull\/(\d+)\/files/);
        return match ? match[1] : null;
    }

    function resetState() {
        fileInfoMap = {};
        directoryInfoMap = {};
        directoryIdIndex = 0;
    }

    function initialiseRoot(fileTree) {
        const checkboxId = 'checkbox-root';

        // Initialise info
        directoryInfoMap['root'] = new DirectoryInfo(null, checkboxId);

        // Update DOM
        const hr = document.createElement('hr');

        hr.style.margin = '2px 0 6px -22px';

        fileTree.insertBefore(hr, fileTree.firstChild);

        const root = document.createElement('div');

        root.style.position = 'relative';
        root.style.padding = '6px 8px';
        root.style.fontStyle = 'italic';
        root.style.color = '#888';

        const checkbox = createCheckbox(checkboxId, false);

        checkbox.addEventListener('change', function () {
            updateAllChildren('root', checkbox.checked);
        });

        root.appendChild(checkbox);
        root.appendChild(document.createTextNode('« All Files »'));

        fileTree.insertBefore(root, fileTree.firstChild);
    }

    function initialiseFileTreeDirectory(fileTreeDirectory) {
        const directoryId = 'directory-' + directoryIdIndex++;

        const parentDirectoryId = getParentDirectoryId(fileTreeDirectory);
        const checkboxId = 'checkbox-directory-' + directoryId;

        // Initialise info
        directoryInfoMap[directoryId] = new DirectoryInfo(parentDirectoryId, checkboxId);

        if (parentDirectoryId) {
            directoryInfoMap[parentDirectoryId].addChildDirectory(directoryId, false);
        }

        // Update DOM
        const checkbox = createCheckbox(checkboxId, false);

        checkbox.addEventListener('change', function () {
            updateAllChildren(directoryId, checkbox.checked);
        });

        fileTreeDirectory.dataset[namespace + 'DirectoryId'] = directoryId;
        fileTreeDirectory.insertBefore(checkbox, fileTreeDirectory.firstChild);
    }

    function initialiseFileTreeFile(fileTreeFile) {
        const fileId = fileTreeFile.getAttribute('id').replace('file-tree-item-diff-', '');

        const parentDirectoryId = getParentDirectoryId(fileTreeFile);
        const checkboxId = 'checkbox-file-' + fileId;
        const fileDiff = document.getElementById('diff-' + fileId) ?? undefined;
        const githubCheckbox = fileDiff?.getElementsByClassName('js-reviewed-checkbox')[0];
        const checkState = fileDiff && (githubCheckbox.checked ? CHECK_STATE_CHECKED : CHECK_STATE_UNCHECKED);

        // Initialise info
        const fileInfo = new FileInfo(
            fileId,
            parentDirectoryId,
            checkboxId,
            checkState,
        );
        fileInfoMap[fileId] = fileInfo;

        if (parentDirectoryId) {
            directoryInfoMap[parentDirectoryId].addChildFile(fileInfo);
        }

        // Update DOM
        const checkbox = createCheckbox(checkboxId, checkState === CHECK_STATE_CHECKED);
        if (checkState === undefined) {
            checkbox.disabled = true;
            checkbox.classList.add(namespace + '-pending');
        }

        if (fileDiff) {
            addChangeListenerToGithubCheckbox(fileDiff, fileId);
        }

        checkbox.addEventListener('change', function () {
            updateGithubCheckbox(fileInfo.getGitHubCheckbox(), checkbox.checked);
        });

        fileTreeFile.insertBefore(checkbox, fileTreeFile.firstChild);
    }

    function updateGithubCheckbox(githubCheckbox, isChecked) {
        if (githubCheckbox.checked === isChecked) {
            return;
        }

        // We need to make sure a change event occurs on the GitHub checkbox, because otherwise the state won't be persisted
        const changeEvent = new CustomEvent("change", {bubbles: true, target: githubCheckbox});
        githubCheckbox.checked = isChecked;
        githubCheckbox.dispatchEvent(changeEvent);
    }

    function updateAllChildren(directoryId, isChecked) {
        const directoryInfo = directoryInfoMap[directoryId];

        for (const directoryChildId of directoryInfo.directoryChildIds) {
            // We don't need to bother updating the checkbox for this directory, because it will be updated indirectly
            // by its file descendants
            updateAllChildren(directoryChildId, isChecked);
        }

        for (const fileChildId of directoryInfo.fileChildIds) {
            const fileDiff = document.getElementById('diff-' + fileChildId);
            const githubCheckbox = fileDiff.getElementsByClassName('js-reviewed-checkbox')[0];
            updateGithubCheckbox(githubCheckbox, isChecked)
        }
    }

    function getParentDirectoryId(node) {
        node = node.parentNode;
        while (node) {
            if (node.dataset.treeEntryType === 'root') {
                return 'root';
            }
            if (node.dataset.treeEntryType === 'directory') {
                return node.dataset[namespace + 'DirectoryId'];
            }

            node = node.parentNode;
        }

        return null;
    }

    function createCheckbox(id, isChecked) {
        const checkbox = document.createElement('input');

        checkbox.setAttribute('id', id);
        checkbox.setAttribute('type', 'checkbox');

        checkbox.style.position = 'absolute';
        checkbox.style.top = '9px';
        checkbox.style.left = '-22px';

        checkbox.checked = isChecked;

        checkbox.addEventListener('click', function (event) {
            // The file checkboxes are nested inside a list item with a click handler, so this is required
            // to prevent the file item from being clicked at the same time
            event.stopPropagation();
        });

        return checkbox;
    }

    function initialiseFileTree(fileTree) {
        fileTree.style.paddingLeft = '22px';

        if (!fileTree.dataset[namespace + 'InitialisedRoot']) {
            fileTree.dataset[namespace + 'InitialisedRoot'] = true;

            initialiseRoot(fileTree);
        }

        // Initialise dirs first, so that files can be added as children
        const fileTreeDirectories = fileTree.querySelectorAll('li[data-tree-entry-type=directory]');
        for (const fileTreeDirectory of fileTreeDirectories) {
            if (fileTreeDirectory.dataset[namespace + 'Initialised']) {
                continue;
            }

            fileTreeDirectory.dataset[namespace + 'Initialised'] = true;

            initialiseFileTreeDirectory(fileTreeDirectory);
        }

        const fileTreeFiles = fileTree.querySelectorAll('li[data-tree-entry-type=file]');
        for (const fileTreeFile of fileTreeFiles) {
            if (fileTreeFile.dataset[namespace + 'Initialised']) {
                continue;
            }

            fileTreeFile.dataset[namespace + 'Initialised'] = true;

            initialiseFileTreeFile(fileTreeFile);
        }
    }

    // Called when the Userscript loads, by which time the page will already have loaded
    function initialiseExistingContent(root) {
        const fileTrees = root.querySelectorAll('file-tree');
        for (const fileTree of fileTrees) {
            initialiseFileTree(fileTree);
        }
    }

    function onFileViewedFormLoaded(formEl) {
        const fileNode = closestAncestor(formEl, function (node) {
            return node.dataset && node.dataset.detailsContainerGroup === 'file';
        });
        const fileId = fileNode.getAttribute('id').replace('diff-', '');

        addChangeListenerToGithubCheckbox(formEl, fileId);
    }

    function addChangeListenerToGithubCheckbox(containerEl, fileId = undefined) {
        const gitHubCheckbox = containerEl.querySelector('input[type=checkbox]');
        gitHubCheckbox.addEventListener('change', () => {
            fileInfoMap[fileId].setIsChecked(gitHubCheckbox.checked);
        });
    }

    function onFileDiffLoaded(fileDiffEl) {
        const fileId = fileDiffEl.id.replace('diff-', '');
        const githubCheckbox = fileDiffEl?.getElementsByClassName('js-reviewed-checkbox')[0];

        fileInfoMap[fileId].setInitialIsChecked(githubCheckbox.checked);

        addChangeListenerToGithubCheckbox(fileDiffEl, fileId);
    }

    // Re-position the selected-file indicators to avoid overlapping the new checkboxes
    const css = `
.ActionList-item.ActionList-item--navActive:not(.ActionList-item--danger)::after { 
    left: 4px; 
}

input[type='checkbox'].${namespace}-partial,
input[type='checkbox'].${namespace}-pending {
    appearance: none;
    width: 13px;
    height: 13px;
}

input[type='checkbox'].${namespace}-partial:not(.${namespace}-pending) {
    background: white;
    border: solid #80b9ff 1px;
    border-width: 5.5px 2.5px;
    border-radius: 2px;
    
    ::before {
        content: '-';
        color: white;
    }
}

input[type='checkbox'].${namespace}-pending {
    display: inline-block;
}

input[type='checkbox'].${namespace}-pending:after {
    content: " ";
    display: block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px solid #80b9ff;
    border-right-color: transparent;
    animation: spin 1.2s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

`;
    injectCss(css);

    let currentPrId = getPrId();
    if (currentPrId) {
        initialiseExistingContent(document);
    }

    let observer = new MutationObserver(function(mutations) {
        const oldPrId = currentPrId;
        currentPrId = getPrId();

        if (!currentPrId) {
            return;
        }

        if (oldPrId !== currentPrId) {
            resetState();
        }

        for (const mutation of mutations) {
            if (mutation.target.classList.contains('js-diff-progressive-container')) {
                // File diff has been loaded, which allows us to set the check-state for the file
                for (const addedNode of mutation.addedNodes) {
                    if (addedNode.tagName === 'DIV' && addedNode.id.startsWith('diff-')) {
                        onFileDiffLoaded(addedNode)
                    }
                }
            } else if (mutation.target.parentElement?.classList.contains('file-actions')) {
                // The 'viewed' checkbox is destroyed and recreated whenever the file diff is collapsed/expanded
                for (const addedNode of mutation.addedNodes) {
                    // Only check elements that don't have the 'display: none' class
                    if (addedNode.nodeType === Node.ELEMENT_NODE) {
                        onFileViewedFormLoaded(addedNode);
                    }
                }
            } else if (mutation.target.id === 'repo-content-turbo-frame') {
                // The user has navigated into the 'files' tab, causing the file-tree to be loaded
                for (const addedNode of mutation.addedNodes) {
                    // Only check elements that don't have the 'display: none' class
                    if (addedNode.nodeType === Node.ELEMENT_NODE && !addedNode.classList.contains('d-none')) {
                        initialiseExistingContent(addedNode);
                    }
                }
            }
        }
    })

    observer.observe(document, {attributes: false, childList: true, characterData: false, subtree:true});
})();
