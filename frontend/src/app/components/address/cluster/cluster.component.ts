import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Transaction } from '@interfaces/electrs.interface';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { ClusterDrawService } from './cluster.draw';

// known satoshi address: http://localhost:4200/address/0411db93e1dcdb8a016b49840f8c53bc1eb68a382e97b1482ecad7b148a6909a5cb2e0eaddfb84ccf9744464f82e160bfa9b8b64f9d4c03f999b8643f656b412a3
// multiple inputs: http://localhost:4200/address/04ea1feff861b51fe3f5f8a3b12d0f4712db80e919548a80839fc47c6a21e66d957e9c5d8cd108c7a2d2324bad71f9904ac0ae7336507d785b17a2c115e427a32f
// multiple outputs: http://localhost:4200/address/1CGqByN5brkvpRrM58d7JXC4VnXb1H1j5d
// 2 inputs: http://localhost:4200/address/12ZYdSCw3dbWcXDqBeVpH2CWAWMVx1fmYt

// prev in external: http://localhost:4200/address/1AqtQTfkngLf7P7TPdXZkWAhs5cqN7t7Fw

// Add this interface near the top of the file
export interface TransactionObject {
  transaction: Transaction;
  clusterIndex: number;
}

@Component({
  selector: 'app-address-cluster',
  templateUrl: './cluster.component.html',
  styleUrls: ['./cluster.component.scss']
})
export class ClusterComponent implements OnChanges, AfterViewInit {
  @Input() transactions: Transaction[];
  @Input() addressString: string;
  @ViewChild('clusterSvg') clusterSvg: ElementRef<SVGSVGElement>;
  @ViewChild('svgContainer') svgContainer: ElementRef;
  
  firstTransaction: Transaction | null = null;
  isLoading = true;
  
  private displayedTransactions: TransactionObject[] = [];
  private branches: string[] = [];
  private branchesArray: TransactionObject[][] = [];
  // SVG zoom and pan properties
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  
  // Computed transform property for SVG
  get transform(): string {
    return `translate(${this.translateX}, ${this.translateY}) scale(${this.scale})`;
  }
  
  // View box for SVG
  get viewBox(): string {
    return `0 0 ${this.svgWidth || 800} ${this.svgHeight || 300}`;
  }

  // SVG dimensions
  private svgWidth = 800;
  private svgHeight = 700;

  constructor(
    private electrsApiService: ElectrsApiService,
    private clusterDrawService: ClusterDrawService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.transactions && this.transactions?.length) {
      this.isLoading = false;
      this.firstTransaction = this.transactions[this.transactions.length - 1]; // Get the oldest transaction
      
      // Initialize the displayed transactions with just the first/oldest transaction
      const clusterIndex = this.findChangeOutputIndex(this.firstTransaction);
      this.displayedTransactions = [{
        transaction: this.firstTransaction,
        clusterIndex: clusterIndex
      }];
      
      // After data is loaded, render the visualization
      setTimeout(() => this.renderTransactionFlow(), 0);
    }
  }
  
  ngAfterViewInit() {
    this.initializeZoom();
    if (this.transactions?.length) {
      this.renderTransactionFlow();
    }
  }
  
  private renderTransactionFlow() {
    if (!this.clusterSvg || !this.displayedTransactions.length) return;
    
    const dimensions = this.clusterDrawService.renderTransactionFlow(
      this.clusterSvg,
      this.displayedTransactions,
      this.branches,
      this.branchesArray,
      this.addressString,
      (txid, address, backtracking, isBranch) => {
        if (backtracking) {
          if (isBranch) {
            this.fetchBranchPrevTransaction(txid, address);
          } else {
            this.fetchPrevTransaction(txid, address);
          }
        } else {
          this.fetchNextTransaction(txid, address);
        }
      }
    );
    
    if (dimensions) {
      this.svgWidth = dimensions.width;
      this.svgHeight = dimensions.height;
    }
  }
  
  private initializeZoom() {
    if (this.svgContainer) {
      this.clusterDrawService.initializeZoom(
        this.svgContainer,
        (scale, translateX, translateY) => {
          this.scale = scale;
          this.translateX = translateX;
          this.translateY = translateY;
        },
        this.scale,
        this.translateX,
        this.translateY
      );
    }
  }

  // New method to find the most likely change output index
  private findChangeOutputIndex(tx: Transaction): number {
    // First check if any output spends back to the input address
    // as is this only applies to the origninal address, should check for spend to any address in cluster.
    for (let i = 0; i < tx.vout.length; i++) {
      const output = tx.vout[i];
      if (output.scriptpubkey_address === this.addressString || 
          output.scriptpubkey === getScriptPubKey(this.addressString)) {
        return i;
      }
    }
    
    // If no direct match, assume the last output is change (common Bitcoin convention)
    return tx.vout.length - 1;
  }

  // Update the addTransaction method to use TransactionObject
  public addTransaction(transaction: Transaction): void {
    if (!this.displayedTransactions.some(txObj => txObj.transaction.txid === transaction.txid)) {
      const clusterIndex = this.findChangeOutputIndex(transaction);
      this.displayedTransactions.push({
        transaction: transaction,
        clusterIndex: clusterIndex
      });
      this.renderTransactionFlow();
    }
  }

  public prependTransaction(transaction: Transaction, clusterIndex: number): void {
    this.displayedTransactions.unshift({
      transaction: transaction,
      clusterIndex: clusterIndex
    });
    this.renderTransactionFlow();
  }

  private prependBranchTransaction(transaction: Transaction, branchIndex: number, clusterIndex: number): void {
    this.branchesArray[branchIndex].unshift({
      transaction: transaction,
      clusterIndex: clusterIndex
    });
    console.log('branchesArray', this.branchesArray);
    this.renderTransactionFlow();
  }
  
  // Update fetchNextTransaction to use TransactionObject
  private fetchNextTransaction(txid: string, address: string): void {
    console.log('fetchNextTransaction', address);
    const txIndex = this.displayedTransactions.findIndex(t => t.transaction.txid === txid);
    
    const currentTxObj = this.displayedTransactions[txIndex];
    const currentTx = currentTxObj.transaction;
    const outputIndex = currentTxObj.clusterIndex;
    
    const outspend = currentTx._outspends[outputIndex];

    // Fetch the transaction that spent this specific output
    this.electrsApiService.getTransaction$(outspend.txid).subscribe(nextTx => {
      // Verify that the input of this transaction matches our expected vin
      const matchingInput = nextTx.vin.find(input => {
        console.log('Checking input:', input);
        console.log('Looking for txid:', currentTx.txid, 'vout:', outputIndex);
        return input.txid === currentTx.txid && input.vout === outputIndex;
      });
      
      if (matchingInput) {
        console.log('Found matching input:', matchingInput);
        // Fetch outspends for this new transaction before adding it
        this.electrsApiService.getOutspends$(nextTx.txid).subscribe(outspends => {
          // Store outspends with the transaction
          nextTx._outspends = outspends;
          
          // create new branch if addl input in cluster
          // http://localhost:4200/address/1JHnexW73ZmTho4F7xYd8Qp5e89qLXrvZg
          // ^ great to test branching
          if (nextTx.vin.length == 2) {
            for (let i = 0; i < nextTx.vin.length; i++) {
              const output = nextTx.vin[i].prevout;
              const inputAddress = this.getAddressFromOutput(output);
              if (inputAddress !== address) {
                this.branches.push(inputAddress);
                this.branchesArray.push([]);
              }
            }
          }

          // Now add the transaction with its outspends to our display list
          this.addTransaction(nextTx);
        });
      } else {
        console.log('Next transaction does not reference the expected input');
        console.log('Current tx:', currentTx.txid);
        console.log('Output index:', outputIndex);
        console.log('Next tx inputs:', nextTx.vin);
      }
    });
  }

  private fetchPrevTransaction(txid: string, address: string): void {
    const txIndex = this.displayedTransactions.findIndex(t => t.transaction.txid === txid);
    const currentTx = this.displayedTransactions[txIndex].transaction;
    const prevTxId = currentTx.vin[0].txid;
    console.log('tx ids', txid, prevTxId);

    this.electrsApiService.getTransaction$(prevTxId).subscribe(prevTx => {
      // find clusterIndex
      const clusterIndex = prevTx.vout.findIndex(vout => {
        return address == this.getAddressFromOutput(vout);
      });
      this.electrsApiService.getOutspends$(prevTx.txid).subscribe(outspends => {
        prevTx._outspends = outspends;
        this.prependTransaction(prevTx, clusterIndex);  
      });
    });
  }

  private fetchBranchPrevTransaction(txid: string, address: string): void {
    const txIndex = this.displayedTransactions.findIndex(t => t.transaction.txid === txid);
    const currentTx = this.displayedTransactions[txIndex].transaction;
    const prevTxId = currentTx.vin.find(vin => {
      const inputAddress = this.getAddressFromOutput(vin.prevout);
      return inputAddress === address;
    }).txid;
    console.log('tx ids', txid, prevTxId);

    this.electrsApiService.getTransaction$(prevTxId).subscribe(prevTx => {
      // find branch index
      const branchIndex = this.branches.indexOf(address);
      // find clusterIndex
      const clusterIndex = prevTx.vout.findIndex(vout => {
        return address == this.getAddressFromOutput(vout);
      })
      this.electrsApiService.getOutspends$(prevTx.txid).subscribe(outspends => {
        prevTx._outspends = outspends;
        this.prependBranchTransaction(prevTx, branchIndex, clusterIndex);  
      });
    });
  }
  
  // Helper method needed by component
  private getAddressFromOutput(output): string {
    return output.scriptpubkey_address || output.scriptpubkey;
  }
}

function getScriptPubKey(address: string): string {
  return address.length === 66 ? '21' : '41' + address + 'ac'
}