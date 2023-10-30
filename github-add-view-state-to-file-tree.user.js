// ==UserScript==
// @name         GitHub Add View-State to File Tree
// @namespace    https://www.bjss.com/
// @version      0.0.1
// @description  Adds functionality relating to the view-state to the file tree on PR files
// @author       Thomas Bickley (thomas.bickley@ba.com)
// @match        https://github.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const datasetPrefix = 'ghvsft'; // GitHub View-State File Tree

    let currentPrId = null;
    /*
     * [fileId] => {
     *    parentDirectoryId: string,
     *    checkedBoxId: string,
     *    checked: boolean,
     * }
     */
    let fileInfoMap = {};
    /*
     * [directoryId] => {
     *    parentDirectoryId: string,
     *    checkedBoxId: string,
     *    checked: boolean,
     *    directoryChildIds: string[],
     *    fileChildIds: string[],
     * }
     */
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

    function debounce(func, timeout = 500){
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => { func.apply(this, args); }, timeout);
        };
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
        directoryInfoMap['root'] = {
            parentDirectoryId: null,
            checkboxId: checkboxId,
            checked: true,
            directoryChildIds: [],
            fileChildIds: [],
        };

        // Update DOM
        const hr = document.createElement('hr');

        hr.style.margin = '2px 0 6px -22px';

        fileTree.insertBefore(hr, fileTree.firstChild);

        const root = document.createElement('div');

        root.style.position = 'relative';
        root.style.padding = '6px 8px';
        root.style.fontStyle = 'italic';
        root.style.color = '#888';

        const checkbox = createCheckbox(checkboxId, true);

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
        directoryInfoMap[directoryId] = {
            parentDirectoryId: parentDirectoryId,
            checkboxId: checkboxId,
            checked: true,
            directoryChildIds: [],
            fileChildIds: [],
        };

        if (parentDirectoryId) {
            directoryInfoMap[parentDirectoryId].directoryChildIds.push(directoryId);
        }

        // Update DOM
        const checkbox = createCheckbox(checkboxId, true);

        checkbox.addEventListener('change', function () {
            updateAllChildren(directoryId, checkbox.checked);
        });

        fileTreeDirectory.dataset[datasetPrefix + 'DirectoryId'] = directoryId;
        fileTreeDirectory.insertBefore(checkbox, fileTreeDirectory.firstChild);
    }

    function initialiseFileTreeFile(fileTreeFile) {
        const fileId = fileTreeFile.getAttribute('id').replace('file-tree-item-diff-', '');

        const parentDirectoryId = getParentDirectoryId(fileTreeFile);
        const checkboxId = 'checkbox-file-' + fileId;
        const fileDiff = document.getElementById('diff-' + fileId);
        const githubCheckbox = fileDiff.getElementsByClassName('js-reviewed-checkbox')[0];
        const checked = fileDiff && githubCheckbox.checked;

        // Initialise info
        fileInfoMap[fileId] = {
            parentDirectoryId: parentDirectoryId,
            checkboxId: checkboxId,
            checked: checked,
        };

        if (parentDirectoryId) {
            directoryInfoMap[parentDirectoryId].fileChildIds.push(fileId);

            // During initialisation, we only need to propagate unchecked inputs, because directories start checked by
            // default
            if (!checked) {
                onChildCheckedUpdate(parentDirectoryId, false);
            }
        }

        // Update DOM
        const checkbox = createCheckbox(checkboxId, checked);

        checkbox.addEventListener('change', function () {
            // We can't use the existing githubCheckbox const here, because GitHub sometimes creates new checkbox
            // elements for some reason
            updateGithubCheckbox(
                fileDiff.getElementsByClassName('js-reviewed-checkbox')[0],
                checkbox.checked
            );
        });

        fileTreeFile.insertBefore(checkbox, fileTreeFile.firstChild);
    }

    function updateGithubCheckbox(githubCheckbox, checked) {
        if (githubCheckbox.checked === checked) {
            return;
        }

        // We need to make sure a change event occurs on the GitHub checkbox, because otherwise the state won't be persisted
        const changeEvent = new CustomEvent("change");
        githubCheckbox.checked = checked;
        githubCheckbox.dispatchEvent(changeEvent);
    }

    function onChildCheckedUpdate(directoryId, checked) {
        const directoryInfo = directoryInfoMap[directoryId];
        if (checked) {
            for (const fileChildId of directoryInfo.fileChildIds) {
                if (!fileInfoMap[fileChildId].checked) {
                    return;
                }
            }

            for (const directoryChildId of directoryInfo.directoryChildIds) {
                if (!directoryInfoMap[directoryChildId].checked) {
                    return;
                }
            }
        } else if (!directoryInfo.checked) {
            return;
        }

        directoryInfo.checked = checked;
        document.getElementById(directoryInfo.checkboxId).checked = checked;

        if (directoryInfo.parentDirectoryId) {
            onChildCheckedUpdate(directoryInfo.parentDirectoryId, checked);
        }
    }

    function updateAllChildren(directoryId, checked) {
        const directoryInfo = directoryInfoMap[directoryId];

        for (const directoryChildId of directoryInfo.directoryChildIds) {
            // We don't need to bother updating the checkbox for this directory, because it will be updated indirectly
            // by its file descendants
            updateAllChildren(directoryChildId, checked);
        }

        for (const fileChildId of directoryInfo.fileChildIds) {
            const fileDiff = document.getElementById('diff-' + fileChildId);
            const githubCheckbox = fileDiff.getElementsByClassName('js-reviewed-checkbox')[0];
            updateGithubCheckbox(githubCheckbox, checked)
        }
    }

    function getParentDirectoryId(node) {
        node = node.parentNode;
        while (node) {
            if (node.dataset.treeEntryType === 'root') {
                return 'root';
            }
            if (node.dataset.treeEntryType === 'directory') {
                return node.dataset[datasetPrefix + 'DirectoryId'];
            }

            node = node.parentNode;
        }

        return null;
    }

    function createCheckbox(id, checked) {
        const checkbox = document.createElement('input');

        checkbox.setAttribute('id', id);
        checkbox.setAttribute('type', 'checkbox');

        checkbox.style.position = 'absolute';
        checkbox.style.top = '9px';
        checkbox.style.left = '-22px';

        checkbox.checked = checked;

        checkbox.addEventListener('click', function (event) {
            // The file checkboxes are nested inside a list item with a click handler, so this is required
            // to prevent the file item from being clicked at the same time
            event.stopPropagation();
        });

        return checkbox;
    }

    function initialiseFileTree(fileTree) {
        fileTree.style.paddingLeft = '22px';

        if (!fileTree.dataset[datasetPrefix + 'InitialisedRoot']) {
            fileTree.dataset[datasetPrefix + 'InitialisedRoot'] = true;

            initialiseRoot(fileTree);
        }

        // Initialise dirs first, so that files can be added as children
        const fileTreeDirectories = fileTree.querySelectorAll('li[data-tree-entry-type=directory]');
        for (const fileTreeDirectory of fileTreeDirectories) {
            if (fileTreeDirectory.dataset[datasetPrefix + 'Initialised']) {
                return;
            }

            fileTreeDirectory.dataset[datasetPrefix + 'Initialised'] = true;

            initialiseFileTreeDirectory(fileTreeDirectory);
        }

        const fileTreeFiles = fileTree.querySelectorAll('li[data-tree-entry-type=file]');
        for (const fileTreeFile of fileTreeFiles) {
            if (fileTreeFile.dataset[datasetPrefix + 'Initialised']) {
                return;
            }

            fileTreeFile.dataset[datasetPrefix + 'Initialised'] = true;

            initialiseFileTreeFile(fileTreeFile);
        }
    }

    function initialiseFileTrees() {
        const fileTrees = document.querySelectorAll('file-tree');
        for (const fileTree of fileTrees) {
            initialiseFileTree(fileTree);
        }
    }

    // Re-position the selected-file indicators to avoid overlapping the new checkboxes
    const css = '.ActionList-item.ActionList-item--navActive:not(.ActionList-item--danger)::after { left: 4px; }';
    injectCss(css);

    // There will be lots of observed mutations while the page is loading, so debounce the initialisation
    const debouncedInitialiseFileTrees = debounce(initialiseFileTrees);

    let observer = new MutationObserver(function() {
        const oldPrId = currentPrId;
        currentPrId = getPrId();

        if (oldPrId !== currentPrId) {
            resetState();
        }

        if (currentPrId) {
            debouncedInitialiseFileTrees();
        }
    })

    observer.observe(document, {attributes: false, childList: true, characterData: false, subtree:true});

    // For some reason GitHub creates a new 'viewed' checkbox after the first time you click it, so instead of us being able to
    // just attach a listener to the appropriate elements during initialisation we have to listen for them at a document level
    document.addEventListener('change', function(event) {
        const githubCheckbox = event.target;
        if (!githubCheckbox || !githubCheckbox.classList.contains('js-reviewed-checkbox')) {
            return;
        }

        const fileNode = closestAncestor(githubCheckbox, function (node) {
            return node.dataset && node.dataset.detailsContainerGroup === 'file';
        });
        const fileId = fileNode.getAttribute('id').replace('diff-', '');
        const fileInfo = fileInfoMap[fileId];
        const checked = githubCheckbox.checked;

        fileInfo.checked = checked;
        document.getElementById(fileInfo.checkboxId).checked = checked;

        if (fileInfo.parentDirectoryId) {
            onChildCheckedUpdate(fileInfo.parentDirectoryId, checked);
        }
    });
})();
