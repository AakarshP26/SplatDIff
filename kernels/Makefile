CC ?= gcc
CFLAGS ?= -O3 -Wall

all: serial/splatdiff_serial serial/splatdiff_omp

serial/splatdiff_serial: serial/splatdiff.c
	$(CC) $(CFLAGS) -o $@ $< -lm

serial/splatdiff_omp: serial/splatdiff.c
	$(CC) $(CFLAGS) -fopenmp -o $@ $< -lm

clean:
	rm -f serial/splatdiff_serial serial/splatdiff_omp
