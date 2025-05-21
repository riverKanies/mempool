import { ElementRef, Injectable } from '@angular/core';
import { Transaction } from '@interfaces/electrs.interface';
import { TransactionObject } from './cluster.component';

interface FirstTxData {
  inputAddress: string;
  type: 'cluster' | 'external';
}

interface Label {
  address?: string;
  count?: number;
  displayText?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ClusterDrawService {
  // Visualization properties
  private nodeRadius = 20;
  private horizontalSpacing = 100;
  private verticalSpacing = 80;
  private svgWidth = 0;
  private svgHeight = 0;
  
  // Node and link styles
  private readonly clusterNodeStyles = {
    fill: '#2e7d32',
    fillHover: '#81c784',
    stroke: '#4caf50',
    strokeWidth: '4px'
  };

  private readonly externalNodeStyles = {
    fill: '#757575',
    fillHover: '#bdbdbd',
    stroke: '#9e9e9e',
    strokeWidth: '4px'
  };

  private readonly linkStyles = {
    stroke: '#fff',
    strokeWidth: '2'
  };

  // Add tooltip element reference
  private tooltipElement: HTMLElement;

  // Add a private property to store transaction objects by txid
  private _transactionMap: {[txid: string]: any} = {};

  constructor() {}

  /**
   * Renders the transaction flow visualization
   */
  public renderTransactionFlow(
    clusterSvg: ElementRef<SVGSVGElement>,
    displayedTransactions: TransactionObject[],
    branches: string[],
    branchesArray: TransactionObject[][],
    addressString: string,
    onNodeClick: (txid: string, address: string, backtracking: boolean, isBranch: boolean) => void,
    tooltipElement?: HTMLElement
  ) {
    if (!clusterSvg || !displayedTransactions.length) return;
    
    // Store tooltip element reference
    if (tooltipElement) {
      this.tooltipElement = tooltipElement;
    }
    
    // Reset transaction map
    this._transactionMap = {};
    
    // Build transaction map for tooltip lookup
    displayedTransactions.forEach(txObj => {
      this._transactionMap[txObj.transaction.txid] = txObj;
    });
    
    // Also add branch transactions to the map
    branchesArray.forEach(branch => {
      branch.forEach(txObj => {
        this._transactionMap[txObj.transaction.txid] = txObj;
      });
    });
    
    const svg = clusterSvg.nativeElement;
    const g = svg.querySelector('g');
    
    // Clear previous content
    while (g.firstChild) {
      g.removeChild(g.firstChild);
    }
    
    // Use the component's internal transaction list
    const orderedTransactions = [...displayedTransactions];
    
    // Calculate SVG dimensions based on transaction count
    this.svgWidth = Math.max(800, orderedTransactions.length * this.horizontalSpacing + 100);
    this.svgHeight = 700;
    
    // Render the main transaction flow
    this.renderBranchFlow(
      g, 
      orderedTransactions, 
      120, // x starting position
      120, // y position
      branches,
      branchesArray,
      onNodeClick,
      true // isMainBranch
    );
    
    return { width: this.svgWidth, height: this.svgHeight };
  }

  /**
   * Generalized method to render transaction flows for both main and sub-branches
   */
  private renderBranchFlow(
    g: SVGElement,
    transactions: TransactionObject[],
    startX: number,
    y: number,
    branches: string[],
    branchesArray: TransactionObject[][],
    onNodeClick: (txid: string, address: string, backtracking: boolean, isBranch: boolean) => void,
    isMainBranch: boolean = false
  ) {
    transactions.forEach((txObj, index) => {
      const tx = txObj.transaction;
      const clusterIndex = txObj.clusterIndex;
      const x = startX + index * this.horizontalSpacing;
      
      // Create node for the address we're focusing on (using the cluster index)
      const clusterAddress = this.getAddressFromOutput(tx.vout[clusterIndex]);
      this.createNode(g, x, y, tx.txid, 'cluster', { address: clusterAddress }, false, false, onNodeClick);
      
      let firstTxData: FirstTxData = null;
      if (index === 0) {
        if (this.isCoinbase(tx)) {
          this.createHorizontalArrow(g, x - this.horizontalSpacing, y, x, y);
          const midpointX = x - this.horizontalSpacing/2;
          this.createTransactionSquare(g, midpointX, y, tx.txid);
          return;
        }
        // for first tx, need to render input node(s)
        // first determine if the output to the original address is change
        // if its last vout in tx, then its change
        firstTxData = {
          inputAddress: this.getAddressFromOutput(tx.vin[0].prevout),
          type: clusterIndex === tx.vout.length - 1 ? 'cluster' : 'external'
        }
        // create input node
        this.createNode(g, x - this.horizontalSpacing, y, tx.txid, firstTxData.type, { address: firstTxData.inputAddress }, true, false, onNodeClick);
      }

      const additionalInputsLabel = this.getAdditionalInputsLabel(index, firstTxData?.inputAddress, transactions);
      if (additionalInputsLabel) {
        // Calculate vertical position for additional inputs
        let additionalY = y + this.verticalSpacing;
        
        // For main branch, handle sub-branches
        if (isMainBranch) {
          const branchIndex = branches.indexOf(additionalInputsLabel.address);
          if (branchIndex > -1) {
            const branchSpacing = (1+branchIndex) * 3 * this.verticalSpacing;
            additionalY = y + branchSpacing;
          }
        }
        
        // Create S-shaped connection to external payment
        this.createSCurve(g, x - this.horizontalSpacing, additionalY, x - (this.horizontalSpacing/4), y, false);

        // Only render sub-branches from the main branch
        if (isMainBranch) {
          const branchIndex = branches.indexOf(additionalInputsLabel.address);
          if (branchIndex > -1 && branchesArray[branchIndex].length > 0) {
            // Skip creating the node since it will be rendered by the sub-branch
            this.renderSubBranch(branchIndex, additionalY, x - this.horizontalSpacing, g, branchesArray, onNodeClick);
          } else {
            // Only create the node if it's not going to be rendered as part of a sub-branch
            this.createNode(
              g, 
              x - this.horizontalSpacing, 
              additionalY, 
              tx.txid, 
              firstTxData?.type || 'cluster', 
              additionalInputsLabel, 
              true, 
              true, 
              onNodeClick
            );
          }
        } else {
          // Always create the node for non-main branches
          this.createNode(
            g, 
            x - this.horizontalSpacing, 
            additionalY, 
            tx.txid, 
            firstTxData?.type || 'cluster', 
            additionalInputsLabel, 
            true, 
            true, 
            onNodeClick
          );
        }
      }

      const externalOutputsLabel = this.getExternalOutputsLabel(tx, clusterIndex);
      if (externalOutputsLabel) {
        const externalY = y - this.verticalSpacing;
        
        this.createNode(
          g, 
          x, 
          externalY, 
          tx.txid, 
          'external', 
          externalOutputsLabel, 
          false, 
          false, 
          onNodeClick
        );
        
        // Create S-shaped connection to external payment
        this.createSCurve(g, x - this.horizontalSpacing*3/4, y, x, externalY);
      }

      this.createHorizontalArrow(g, x - this.horizontalSpacing, y, x, y);
      const midpointX = x - this.horizontalSpacing/2;
      this.createTransactionSquare(g, midpointX, y, tx.txid);
    });
  }

  /**
   * Renders a sub-branch of transactions
   */
  private renderSubBranch(
    branchIndex: number, 
    y: number, 
    branchX: number, 
    g: SVGElement, 
    branchesArray: TransactionObject[][],
    onNodeClick: (txid: string, address: string, backtracking: boolean, isBranch: boolean) => void
  ) {
    const branch = branchesArray[branchIndex];
    // Calculate starting X position for the branch (right to left)
    const startX = branchX - this.horizontalSpacing * (branch.length - 1);
    
    this.renderBranchFlow(
      g,
      branch,
      startX,
      y,
      [], // No sub-branches for branches
      [], // No branch array needed
      onNodeClick,
      false // Not a main branch
    );
  }
  
  private createNode(
    parent: SVGElement, 
    x: number, 
    y: number, 
    txid: string, 
    type: 'cluster' | 'external' = 'cluster', 
    label: Label,
    backtracking: boolean = false, 
    isBranch: boolean = false,
    onNodeClick: (txid: string, address: string, backtracking: boolean, isBranch: boolean) => void
  ) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x.toString());
    circle.setAttribute('cy', y.toString());
    circle.setAttribute('r', this.nodeRadius.toString());
    circle.setAttribute('data-x', x.toString());
    circle.setAttribute('data-y', y.toString());
    
    const address = label?.address || '';
    circle.setAttribute('data-address', address);
    
    // Apply styles directly to the element
    if (type === 'cluster') {
      const coinColor = label?.count ? this.clusterNodeStyles.fill : addressToColor(address);
      circle.setAttribute('class', 'cluster-node');
      circle.setAttribute('fill', coinColor);
      circle.setAttribute('stroke', this.clusterNodeStyles.stroke);
      circle.setAttribute('stroke-width', this.clusterNodeStyles.strokeWidth);
      circle.setAttribute('cursor', 'pointer');
      // Add hover effect with JavaScript since we can't use CSS :hover
      circle.addEventListener('mouseenter', (event) => {
        circle.setAttribute('fill', this.clusterNodeStyles.fillHover);
        this.showNodeTooltip(txid, label, type, event);
        this.drawConnectionCurve(parent, circle);
      });
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('fill', coinColor);
        this.hideTooltip();
        this.removeConnectionCurve(parent);
      });
    } else {
      circle.setAttribute('class', 'external-node');
      circle.setAttribute('fill', this.externalNodeStyles.fill);
      circle.setAttribute('stroke', this.externalNodeStyles.stroke);
      circle.setAttribute('stroke-width', this.externalNodeStyles.strokeWidth);
      circle.setAttribute('cursor', 'pointer');
      // Add hover effect with JavaScript
      circle.addEventListener('mouseenter', (event) => {
        circle.setAttribute('fill', this.externalNodeStyles.fillHover);
        this.showNodeTooltip(txid, label, type, event);
        this.drawConnectionCurve(parent, circle);
      });
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('fill', this.externalNodeStyles.fill);
        this.hideTooltip();
        this.removeConnectionCurve(parent);
      });
    }
    
    circle.setAttribute('data-txid', txid);
    
    // Update click event to fetch next transaction instead of navigating
    circle.addEventListener('click', () => {
      if (type !== 'cluster') return;
      onNodeClick(txid, address, backtracking, isBranch);
    });
    
    parent.appendChild(circle);
    
    // Add label text only if we have a count to display (for clusters of addresses)
    if (label?.count) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x.toString());
      text.setAttribute('y', y.toString()); // Center vertically in the circle
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle'); // This ensures vertical centering
      text.setAttribute('class', 'node-label');
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-size', '12px');
      text.setAttribute('font-weight', 'bold'); // Make text bold
      text.setAttribute('user-select', 'none');
      text.setAttribute('pointer-events', 'none'); // Make text transparent to mouse events
      
      // Generate display text based on type and count
      const displayText = `${label.count}`;
      text.textContent = displayText;
      
      parent.appendChild(text);
    }
  }
  
  private createHorizontalArrow(parent: SVGElement, x1: number, y1: number, x2: number, y2: number) {
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    arrow.setAttribute('x1', (x1 + this.nodeRadius).toString());
    arrow.setAttribute('y1', y1.toString());
    arrow.setAttribute('x2', (x2 - this.nodeRadius).toString());
    arrow.setAttribute('y2', y2.toString());
    arrow.setAttribute('stroke', this.linkStyles.stroke);
    arrow.setAttribute('stroke-width', this.linkStyles.strokeWidth);
    arrow.setAttribute('marker-end', 'url(#arrowhead)');
    arrow.setAttribute('class', 'cluster-link');
    parent.appendChild(arrow);
  }
  
  private createSCurve(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, renderArrow: boolean = true) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const controlX1 = x1 + this.horizontalSpacing * 0.5;
    const controlY1 = y1;
    const controlX2 = x2 - this.horizontalSpacing * 0.5;
    const controlY2 = y2;
    
    path.setAttribute('d', `M ${x1 + this.nodeRadius} ${y1} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${x2 - this.nodeRadius} ${y2}`);
    path.setAttribute('stroke', this.linkStyles.stroke);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', this.linkStyles.strokeWidth);
    if (renderArrow) path.setAttribute('marker-end', 'url(#arrowhead)');
    path.setAttribute('class', 'cluster-link');
    parent.appendChild(path);
  }
  
  /**
   * Creates a square node to represent a transaction
   */
  private createTransactionSquare(
    parent: SVGElement,
    x: number,
    y: number,
    txid: string
  ) {
    const squareSize = 15; // Size of the transaction square
    const square = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    square.setAttribute('x', (x - squareSize/2).toString());
    square.setAttribute('y', (y - squareSize/2).toString());
    square.setAttribute('width', squareSize.toString());
    square.setAttribute('height', squareSize.toString());
    square.setAttribute('fill', '#fff');
    square.setAttribute('stroke', '#fff');
    square.setAttribute('stroke-width', '1px');
    square.setAttribute('data-txid', txid);
    square.setAttribute('cursor', 'pointer');
  
    // Add hover effect with JavaScript
    square.addEventListener('mouseenter', () => {
      square.setAttribute('fill', '#ffb74d'); // Lighter orange on hover
      this.showTooltip(txid, event);
    });
    
    square.addEventListener('mouseleave', () => {
      square.setAttribute('fill', '#fff'); // Back to original color
      this.hideTooltip();
    });
    
    parent.appendChild(square);
  }
  
  /**
   * Show tooltip with node details
   */
  private showNodeTooltip(txid: string, label: Label, type: string, event: any): void {
    if (!this.tooltipElement) return;
    
    // Check if we have a count or address
    if (label?.count) {
      // Create tooltip content for multiple addresses
      let tooltipContent = `
        <div>
          <strong>${type === 'cluster' ? 'Cluster' : 'External'} Addresses:</strong><br>
          <span style="font-family: monospace;">${label.count} Addresses</span>
        </div>
      `;
      
      // Set tooltip content
      this.tooltipElement.innerHTML = tooltipContent;
    } else {
      const address = label?.address || '';
      
      // Format the address for display
      const formattedAddress = address.length > 20 
        ? `${address.substring(0, 10)}...${address.substring(address.length - 10)}`
        : address;
      
      // Create tooltip content
      let tooltipContent = `
        <div>
          <strong>${type === 'cluster' ? 'Cluster' : 'External'} Address:</strong><br>
          <span style="font-family: monospace;">${formattedAddress}</span>
        </div>
      `;

      if (type === 'cluster') {
        tooltipContent += `
          <div style="margin-top: 5px;">
            <strong>Click to fetch next transaction -></strong>
          </div>
        `;
      }
      
      // Set tooltip content
      this.tooltipElement.innerHTML = tooltipContent;
    }
    
    // Show tooltip
    this.tooltipElement.style.opacity = '1';
    this.updateTooltipPosition(event);
  }
  
  /**
   * Show tooltip with transaction details
   */
  private showTooltip(txid: string, event: any): void {
    if (!this.tooltipElement) return;
    
    // Find the transaction object by txid to get heuristics
    const txObj = this.findTransactionObjectByTxid(txid);
    
    // Format the transaction ID for display
    const formattedTxid = `${txid.substring(0, 8)}...${txid.substring(txid.length - 8)}`;
    
    // Create tooltip content with heuristics if available
    let tooltipContent = `
      <div>
        <strong>Transaction:</strong><br>
        <span style="font-family: monospace;">${formattedTxid}</span>
      </div>
    `;
    
    // Add heuristics information if available
    if (txObj && txObj.heuristics && txObj.heuristics.length > 0) {
      tooltipContent += `<div style="margin-top: 5px;"><strong>Heuristics:</strong><br>`;
      
      txObj.heuristics.forEach(heuristic => {
        let heuristicText = '';
        switch(heuristic) {
          case 0: // HeuristicType.cio
            heuristicText = 'Common Input Ownership';
            break;
          case 1: // HeuristicType.change
            heuristicText = 'Change';
            break;
          case 2: // HeuristicType.reused
            heuristicText = 'Cluster Address';
            break;
        }
        tooltipContent += `<span style="display: block; margin-left: 5px;">• ${heuristicText}</span>`;
      });
      
      tooltipContent += `</div>`;
    }
    
    // Set tooltip content
    this.tooltipElement.innerHTML = tooltipContent;
    
    // Show tooltip
    this.tooltipElement.style.opacity = '1';
    this.updateTooltipPosition(event);
  }
  
  /**
   * Update tooltip position based on mouse coordinates
   */
  private updateTooltipPosition(event: any): void {
    if (!this.tooltipElement) return;
    
    const offsetX = 50; // Offset from cursor for X axis
    const offsetY = -20; // Offset from cursor for Y axis
    
    // Get mouse position relative to the viewport
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    
    // Get tooltip dimensions
    const tooltipWidth = this.tooltipElement.offsetWidth;
    const tooltipHeight = this.tooltipElement.offsetHeight;
    
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get SVG container position
    const svgElement = event.target.closest('svg');
    const svgRect = svgElement ? svgElement.getBoundingClientRect() : null;
    const svgOffsetX = svgRect ? svgRect.left : 0;
    const svgOffsetY = svgRect ? svgRect.top : 0;
    
    // Calculate position to ensure tooltip stays within viewport
    // Position tooltip above and to the right of cursor by default
    let left = mouseX + offsetX + scrollX - svgOffsetX;
    let top = mouseY - tooltipHeight - offsetY - svgOffsetY;
    
    // If positioning above would go off the top of the screen, position below instead
    if (mouseY - tooltipHeight - offsetY < 0) {
      top = mouseY + offsetY + scrollY - svgOffsetY;
    }
    
    // Adjust if tooltip would go off right edge
    if (mouseX + offsetX + tooltipWidth > viewportWidth) {
      left = mouseX - tooltipWidth - offsetX - svgOffsetX;
    }
    
    // Set tooltip position
    this.tooltipElement.style.left = `${left}px`;
    this.tooltipElement.style.top = `${top}px`;
  }
  
  /**
   * Hide tooltip
   */
  private hideTooltip(): void {
    if (this.tooltipElement) {
      this.tooltipElement.style.opacity = '0';
    }
  }
  
  /**
   * Initialize zoom and pan functionality for the SVG container
   */
  public initializeZoom(
    svgContainer: ElementRef, 
    onZoomPan: (scale: number, translateX: number, translateY: number) => void,
    initialScale: number,
    initialTranslateX: number,
    initialTranslateY: number
  ) {
    if (svgContainer) {
      const element = svgContainer.nativeElement;
      let scale = initialScale;
      let translateX = initialTranslateX;
      let translateY = initialTranslateY;
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      
      // Mouse wheel zoom
      element.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault();
        
        // Calculate mouse position relative to the SVG container
        const rect = element.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const zoomFactor = 1 - Math.sign(event.deltaY) * 0.01; // Adjusted for smoother zooming
        const newScale = Math.max(0.5, Math.min(scale * zoomFactor, 5));
        
        // Calculate the mouse position in SVG coordinates before zoom
        const svgPointBefore = {
          x: (mouseX - translateX) / scale,
          y: (mouseY - translateY) / scale
        };

        // Update scale
        scale = newScale;

        // Adjust translation to keep the point under the mouse fixed
        translateX = mouseX - svgPointBefore.x * scale;
        translateY = mouseY - svgPointBefore.y * scale;
        
        // Notify component of changes
        onZoomPan(scale, translateX, translateY);
      }, { passive: false });
      
      // Mouse drag for panning
      element.addEventListener('mousedown', (event: MouseEvent) => {
        isDragging = true;
        startX = event.clientX - translateX;
        startY = event.clientY - translateY;
        element.style.cursor = 'grabbing';
      });
      
      element.addEventListener('mousemove', (event: MouseEvent) => {
        if (isDragging) {
          translateX = event.clientX - startX;
          translateY = event.clientY - startY;
          onZoomPan(scale, translateX, translateY);
        }
      });
      
      // End dragging
      const endDrag = () => {
        isDragging = false;
        element.style.cursor = 'grab';
      };
      
      element.addEventListener('mouseup', endDrag);
      element.addEventListener('mouseleave', endDrag);
      
      // Set initial cursor
      element.style.cursor = 'grab';
    }
  }
  
  // Helper methods
  private getAddressFromOutput(output): string {
    return output.scriptpubkey_address || output.scriptpubkey;
  }
  
  private isCoinbase(tx: Transaction): boolean {
    return tx.vin.some(input => input.is_coinbase);
  }
  
  private getAdditionalInputsLabel(txIndex: number, inputAddress: string, displayedTransactions: TransactionObject[]): Label {
    const tx = displayedTransactions[txIndex].transaction;
    if (tx.vin.length == 2) {
      const address = this.findAdditionalInputAddress(txIndex, inputAddress, displayedTransactions);
      return { address };
    }

    if (tx.vin.length > 2) {
      return { count: tx.vin.length - 1, displayText: `Cluster ${tx.vin.length - 1}` };
    }

    return null;
  }

  private findAdditionalInputAddress(txIndex: number, inputAddress: string, displayedTransactions: TransactionObject[]): string {
    let clusterAddress = inputAddress // null unless input to first tx
    if (!clusterAddress) {
      const prevTxObj = displayedTransactions[txIndex - 1];
      if (!prevTxObj) {
        console.error('No previous transaction found');
        return null;
      }
      const prevTx = prevTxObj.transaction;
      const prevClusterIndex = prevTxObj.clusterIndex;
      clusterAddress = this.getAddressFromOutput(prevTx.vout[prevClusterIndex]);
    }
    const currentTx = displayedTransactions[txIndex].transaction;
    // Look for an input address that is not the change address from previous tx
    for (let i = 0; i < currentTx.vin.length; i++) {
      const output = currentTx.vin[i].prevout;
      const inputAddress = this.getAddressFromOutput(output);
      if (inputAddress !== clusterAddress) {// TODO: it is possible for multiple inputs to be the same address
        return inputAddress;
      }
    }
    return 'Unknown Address';
  }

  private getExternalOutputsLabel(tx: Transaction, clusterIndex: number): Label {
    if (tx.vout.length == 2) {
      const address = this.findExternalAddress(tx, clusterIndex);
      return { address };
    }

    if (tx.vout.length > 2) {
      return { count: tx.vout.length - 1, displayText: `Batch ${tx.vout.length - 1}` };
    }

    return null;
  }
  
  private findExternalAddress(tx: Transaction, changeIndex: number): string {
    // Look for an output that is not the change output
    for (let i = 0; i < tx.vout.length; i++) {
      if (i !== changeIndex) {
        const output = tx.vout[i];
        return output.scriptpubkey_address || output.scriptpubkey;
      }
    }
    return 'Unknown Address';
  }

  /**
   * Find transaction object by txid from displayed transactions or branches
   */
  private findTransactionObjectByTxid(txid: string): any {
    // This method will be populated with transaction data during rendering
    if (!this._transactionMap) return null;
    return this._transactionMap[txid] || null;
  }

  /**
   * Draw curved connections between the hovered node and all nodes with the same address
   */
  private drawConnectionCurve(parent: SVGElement, hoveredNode: SVGCircleElement): void {
    // Remove any existing connection curves
    this.removeConnectionCurve(parent);
    
    // Get the position and address of the hovered node
    const x1 = parseFloat(hoveredNode.getAttribute('cx'));
    const y1 = parseFloat(hoveredNode.getAttribute('cy'));
    const hoveredAddress = hoveredNode.getAttribute('data-address');
    
    if (!hoveredAddress) return;
    
    // Find all nodes with the same address
    const matchingNodes = this.findNodesWithSameAddress(parent, hoveredNode, hoveredAddress);
    
    if (matchingNodes.length === 0) return;
    
    // Draw a curve to each matching node
    matchingNodes.forEach(node => {
      // Get the position of the matching node
      const x2 = parseFloat(node.getAttribute('cx'));
      const y2 = parseFloat(node.getAttribute('cy'));
      
      // Calculate the starting and ending points at 45-degree angles
      const radius = this.nodeRadius;
      const angle = Math.PI / 4; // 45 degrees in radians
      
      // Calculate starting point (top-left of first node)
      const startX = x1 - radius * Math.cos(angle);
      const startY = y1 - radius * Math.sin(angle);
      
      // Calculate ending point (top-left of second node)
      const endX = x2 - radius * Math.cos(angle);
      const endY = y2 - radius * Math.sin(angle);
      
      // Create the curved path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      
      // Calculate control points for a nice curve
      const controlX1 = startX - 30;
      const controlY1 = startY - 30;
      const controlX2 = endX - 30;
      const controlY2 = endY - 30;
      
      // Create the path data for a cubic Bezier curve
      const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
      
      path.setAttribute('d', pathData);
      path.setAttribute('stroke', 'rgba(255, 152, 0, 0.5)'); // Semi-transparent orange for the connection
      path.setAttribute('stroke-width', '3');
      path.setAttribute('fill', 'none');
      // path.setAttribute('stroke-dasharray', '5,5'); // Dashed line
      path.setAttribute('class', 'connection-curve');
      
      // Add the path to the SVG
      parent.appendChild(path);
    });
  }

  /**
   * Find all nodes with the same address as the hovered node
   */
  private findNodesWithSameAddress(parent: SVGElement, hoveredNode: SVGCircleElement, address: string): SVGCircleElement[] {
    // Get all nodes
    const nodes = Array.from(parent.querySelectorAll('circle'));
    
    // Filter out the hovered node and find nodes with matching address
    return nodes.filter(node => {
      if (node === hoveredNode) return false;
      const nodeAddress = node.getAttribute('data-address');
      if (nodeAddress.length < 12) return false;// match only actual addresses, not other labels
      return nodeAddress === address;
    }) as SVGCircleElement[];
  }

  /**
   * Remove all connection curves
   */
  private removeConnectionCurve(parent: SVGElement): void {
    const existingCurves = parent.querySelectorAll('.connection-curve');
    existingCurves.forEach(curve => {
      parent.removeChild(curve);
    });
  }
}

function addressToColor(address) {
  // Use a simple hash function to convert the address to a number
  let hash = 0;
  
  // Loop through each character in the address
  for (let i = 0; i < address.length; i++) {
    // Get character code and add to hash
    const char = address.charCodeAt(i);
    // Simple hash algorithm: multiply by 31 and add character code
    hash = ((hash << 5) - hash) + char;
    // Convert to 32-bit integer
    hash = hash & hash;
  }
  
  // Convert to positive number and take modulo 16777216 (0xFFFFFF + 1)
  // This ensures we get a value that fits in 6 hex digits
  const positiveHash = Math.abs(hash) % 16777216;
  
  // Convert to hex and pad with zeros if needed
  let hexColor = positiveHash.toString(16);
  while (hexColor.length < 6) {
    hexColor = '0' + hexColor;
  }
  
  return '#' + hexColor;
}