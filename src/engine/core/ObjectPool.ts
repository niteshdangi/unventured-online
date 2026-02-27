export class ObjectPool<T> {
    private pool: T[] = [];
    private createFn: () => T;
    private resetFn: (item: T) => void;

    constructor(createFn: () => T, resetFn: (item: T) => void, initialSize: number = 0) {
        this.createFn = createFn;
        this.resetFn = resetFn;

        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
        }
    }

    public get(): T {
        if (this.pool.length > 0) {
            const item = this.pool.pop()!;
            this.resetFn(item);
            return item;
        }

        // Expand pool if necessary
        const newItem = this.createFn();
        this.resetFn(newItem);
        return newItem;
    }

    public release(item: T) {
        this.pool.push(item);
    }

    public getCount(): number {
        return this.pool.length;
    }
}
